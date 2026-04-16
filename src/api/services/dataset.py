"""
Dataset service for handling dataset and file creation.
"""

import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.file import File
from models.file_download import FileDownloadCount
from models.organization import Organization
from models.tag import Tag
from models.tag_dataset import TagDataset
from models.user import User
from models.user_contribution import UserContribution
from schemas.dataset import DatasetCreate
from services.organization import OrganizationService, get_organization_service
from services.upload import UploadService, get_upload_service
from services.user import UserService, get_user_service
from sqlalchemy import delete, desc, func, or_, select, update
from tasks.email import send_dataset_transfer
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from utils.security import sanitize_input

logger = logging.getLogger(__name__)


def _mask_apikey(apikey: Optional[str]) -> str:
    """Return a masked API key representation safe for logs."""
    if not apikey:
        return "none"
    stripped_apikey = apikey.strip()
    if not stripped_apikey:
        return "empty"
    if len(stripped_apikey) <= 4:
        return f"***{stripped_apikey}"
    return f"{'*' * (len(stripped_apikey) - 4)}{stripped_apikey[-4:]}"


class DatasetService:
    """
    Service class for dataset operations with comprehensive validation and security.

    This service handles:
    - Organization validation
    - File existence verification in S3
    - Dataset and file record creation
    - Private dataset logic based on organization settings
    """

    def __init__(
        self,
        session: AsyncSession,
        org_service: OrganizationService,
        upload_service: UploadService,
        user_service: UserService,
    ):
        self.session = session
        self.org_service = org_service
        self.upload_service = upload_service
        self.user_service = user_service
        self.logger = logging.getLogger(__name__)
        self.s3_bucket = settings.S3_BUCKET

    async def validate_creator(self, creator_id: UUID, current_user: User) -> None:
        """
        Validate that the creator matches the authenticated user.

        Args:
            creator_id: Creator ID from form data
            current_user: Currently authenticated user

        Raises:
            HTTPException: If creator doesn't match authenticated user
        """
        try:
            if creator_id != current_user.id:
                self.logger.warning(
                    "Creator ID mismatch: creator=%s, current_user=%s",
                    creator_id,
                    current_user.id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Creator ID must match authenticated user",
                )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Error validating creator: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error validating creator",
            )

    def _normalize_tags(self, tags: Optional[List[str]]) -> List[str]:
        """
        Normalize tag strings: strip, replace internal whitespace with '-', lowercase,
        and deduplicate while preserving order.

        Args:
            tags: Optional list of raw tag strings

        Returns:
            List of normalized, deduplicated tag strings
        """
        if not tags:
            return []
        result: List[str] = []
        for tag_str in tags:
            tag_stripped = tag_str.strip() if tag_str else ""
            if not tag_stripped:
                continue
            normalized_tag = re.sub(r"\s+", "-", tag_stripped).lower()
            result.append(normalized_tag)
        return list(dict.fromkeys(result))

    async def attach_tags_to_dataset(
        self, dataset_id: UUID, tags: Optional[List[str]]
    ) -> None:
        """Create/link Tag rows and TagDataset rows for an existing dataset."""
        try:
            ds_check = await self.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            if ds_check.scalar_one_or_none() is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Dataset not found",
                )
            await self.session.execute(
                delete(TagDataset).where(TagDataset.dataset_id == dataset_id)
            )
            normalized_tags = self._normalize_tags(tags)
            for normalized_tag in normalized_tags:
                tag_result = await self.session.execute(
                    select(Tag).where(func.lower(Tag.tag_name) == normalized_tag)
                )
                existing_tag = tag_result.scalar_one_or_none()
                if existing_tag:
                    tag_id = existing_tag.tag_id
                else:
                    tag_id = uuid4()
                    self.session.add(Tag(tag_id=tag_id, tag_name=normalized_tag))
                self.session.add(
                    TagDataset(dataset_id=dataset_id, tag_id=tag_id),
                )
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "attach_tags_to_dataset failed for dataset_id=%s: %s", dataset_id, e
            )
            raise

    async def get_organization_with_private_status(self, org_id: str) -> Organization:
        """
        Get organization and return with its private status.

        Args:
            org_id: Organization ID

        Returns:
            Organization object

        Raises:
            HTTPException: If organization not found
        """
        try:
            organization = await self.org_service.get_organization_by_id(org_id)
            if not organization:
                self.logger.warning("Organization not found: %s", org_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Organization '{org_id}' not found",
                )
            return organization
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Error fetching organization: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching organization",
            )

    async def validate_file_exists(self, file_key: str) -> int:
        """
        Validate that file exists in S3 and return its size.

        Args:
            file_key: S3 file key

        Returns:
            File size in bytes

        Raises:
            HTTPException: If file doesn't exist or service error
        """
        try:
            file_status = await self.upload_service.check_file_status_by_key(file_key)

            if not file_status.get("exists", False):
                self.logger.warning("File does not exist in S3: %s", file_key)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File does not exist in S3",
                )

            file_size = file_status.get("size", 0)
            if file_size is None:
                file_size = 0

            self.logger.info(
                "File validated in S3: key=%s, size=%d", file_key, file_size
            )
            return file_size

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Error validating file existence: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error validating file existence",
            )

    async def get_download_totals_for_datasets(
        self, dataset_ids: List[UUID]
    ) -> Dict[UUID, int]:
        """
        Return total download count per dataset (sum of file_download_counts).
        Missing dataset_ids get 0.
        """
        if not dataset_ids:
            return {}
        result = await self.session.execute(
            select(FileDownloadCount.dataset_id, func.sum(FileDownloadCount.downloads))
            .where(FileDownloadCount.dataset_id.in_(dataset_ids))
            .group_by(FileDownloadCount.dataset_id)
        )
        rows = result.all()
        out: Dict[UUID, int] = {did: 0 for did in dataset_ids}
        for row in rows:
            out[row[0]] = int(row[1])
        return out

    async def get_download_counts_for_files(
        self, file_ids: List[UUID]
    ) -> Dict[UUID, int]:
        """
        Return download count per file_id from file_download_counts.
        Missing file_ids get 0.
        """
        if not file_ids:
            return {}
        result = await self.session.execute(
            select(FileDownloadCount.file_id, FileDownloadCount.downloads).where(
                FileDownloadCount.file_id.in_(file_ids)
            )
        )
        rows = result.all()
        out: Dict[UUID, int] = {fid: 0 for fid in file_ids}
        for row in rows:
            out[row[0]] = int(row[1])
        return out

    async def check_dataset_permission(
        self,
        user_id: Optional[UUID],
        apikey: Optional[str],
        dataset_id: UUID,
    ) -> bool:
        """
        Check if the user has permission to modify/delete the dataset.

        Uses session user_id first when provided; otherwise uses apikey. This matches
        _compute_privileges and avoids mixed identity when both are present.

        Permission check order (for the resolved identity):
        1. Check if user is the dataset creator
        2. Check if user has high role (role > 0) AND belongs to dataset's organization
        3. Check if user is superuser

        Args:
            user_id: User ID (from session); preferred when set
            apikey: API key of the user; used when user_id is not provided
            dataset_id: UUID of the dataset

        Returns:
            True if user has permission, False otherwise
        """
        try:
            if user_id is not None:
                return await self._check_dataset_permission_by_user_id(
                    user_id, dataset_id
                )
            if apikey and apikey.strip():
                return await self._check_dataset_permission_by_apikey(
                    apikey, dataset_id
                )
            self.logger.info(
                "Permission denied: no user_id or apikey for dataset %s", dataset_id
            )
            return False
        except Exception as e:
            masked_apikey = _mask_apikey(apikey)
            self.logger.exception(
                "Error checking dataset permission: user_id=%s, apikey=%s, dataset_id=%s, error=%s",
                user_id,
                masked_apikey,
                dataset_id,
                e,
            )
            return False

    async def _check_dataset_permission_by_apikey(
        self, apikey: str, dataset_id: UUID
    ) -> bool:
        """Run permission checks using apikey."""
        masked_apikey = _mask_apikey(apikey)
        is_creator = await self.user_service.check_if_dataset_creator_by_key(
            apikey, dataset_id
        )
        if is_creator:
            self.logger.info(
                "Permission granted: user with apikey %s is creator of dataset %s",
                masked_apikey,
                dataset_id,
            )
            return True
        has_high_role = await self.user_service.check_if_high_role_by_key(apikey)
        belongs_to_org = (
            await self.user_service.check_user_belongs_to_dataset_organization_by_key(
                apikey, dataset_id
            )
        )
        if has_high_role and belongs_to_org:
            self.logger.info(
                "Permission granted: user with apikey %s has high role and belongs to dataset %s organization",
                masked_apikey,
                dataset_id,
            )
            return True
        is_superuser = await self.user_service.check_if_superuser_by_key(apikey)
        if is_superuser:
            self.logger.info(
                "Permission granted: user with apikey %s is superuser for dataset %s",
                masked_apikey,
                dataset_id,
            )
            return True
        self.logger.info(
            "Permission denied: apikey %s does not have permission for dataset %s",
            masked_apikey,
            dataset_id,
        )
        return False

    async def _check_dataset_permission_by_user_id(
        self, user_id: UUID, dataset_id: UUID
    ) -> bool:
        """Run permission checks using user_id."""
        is_creator = await self.user_service.check_if_dataset_creator_by_id(
            user_id, dataset_id
        )
        if is_creator:
            self.logger.info(
                "Permission granted: user %s is creator of dataset %s",
                user_id,
                dataset_id,
            )
            return True
        has_high_role = await self.user_service.check_if_high_role_by_id(user_id)
        belongs_to_org = (
            await self.user_service.check_user_belongs_to_dataset_organization_by_id(
                user_id, dataset_id
            )
        )
        if has_high_role and belongs_to_org:
            self.logger.info(
                "Permission granted: user %s has high role and belongs to dataset %s organization",
                user_id,
                dataset_id,
            )
            return True
        is_superuser = await self.user_service.check_if_superuser_by_id(user_id)
        if is_superuser:
            self.logger.info(
                "Permission granted: user %s is superuser for dataset %s",
                user_id,
                dataset_id,
            )
            return True
        self.logger.info(
            "Permission denied: user %s does not have permission for dataset %s",
            user_id,
            dataset_id,
        )
        return False

    async def create_dataset_with_file(
        self, dataset_data: DatasetCreate, current_user: User
    ) -> Tuple[Dataset, File]:
        """
        Create a dataset and its associated file record.

        This method:
        1. Validates creator matches authenticated user
        2. Validates organization exists
        3. Validates file exists in S3
        4. Applies private dataset logic
        5. Creates and adds dataset record to session (must be before tags)
        6. Processes tags and creates tag associations
        7. Creates file record
        8. Commits all changes

        Args:
            dataset_data: Dataset creation data from form
            current_user: Currently authenticated user

        Returns:
            Tuple of (created Dataset, created File)

        Raises:
            HTTPException: If validation fails or creation fails
        """
        try:
            self.logger.info(
                "Creating dataset: title=%s, creator=%s",
                dataset_data.title,
                dataset_data.creator,
            )

            # 1. Validate creator matches authenticated user
            await self.validate_creator(dataset_data.creator, current_user)

            # 2. Validate organization exists and get its private status
            organization = await self.get_organization_with_private_status(
                dataset_data.organization
            )

            # 3. Validate file exists in S3 and get size
            file_size = await self.validate_file_exists(dataset_data.file_key)

            # 4. Apply private dataset logic
            # If dataset private=True but organization private=False, set dataset private=False
            dataset_private = dataset_data.private
            if dataset_private and not organization.private:
                self.logger.info(
                    "Dataset marked private but organization is not private. "
                    "Setting dataset private=False for org_id=%s",
                    organization.id,
                )
                dataset_private = False

            # 5. Generate UUIDs
            dataset_id = uuid4()
            file_id = uuid4()

            # 6. Sanitize input fields
            sanitized_title = sanitize_input(dataset_data.title) or ""
            sanitized_dataset_desc = sanitize_input(dataset_data.dataset_description)

            # Sanitize file fields
            sanitized_filename = sanitize_input(dataset_data.filename) or ""
            sanitized_file_desc = sanitize_input(dataset_data.file_description)
            sanitized_file_format = sanitize_input(dataset_data.file_format)
            sanitized_provenance = sanitize_input(dataset_data.provenance)
            sanitized_source = sanitize_input(dataset_data.source)
            sanitized_cite_as = sanitize_input(dataset_data.cite_as)
            sanitized_geography = sanitize_input(dataset_data.geography)

            # Validate and sanitize permissions - must be one of the allowed CC license values
            allowed_permissions = [
                "CC0: Public Domain",
                "CC BY: Attribution",
                "CC BY-SA: Attribution-ShareAlike",
                "CC BY-NC: Attribution-NonCommercial",
                "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
                "CC BY-ND: Attribution-NoDerivatives",
                "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
            ]
            permissions_value = dataset_data.permissions
            if permissions_value is None or (
                isinstance(permissions_value, str) and not permissions_value.strip()
            ):
                sanitized_permissions = "CC0: Public Domain"
            else:
                permissions_stripped = (
                    permissions_value.strip()
                    if isinstance(permissions_value, str)
                    else str(permissions_value).strip()
                )
                if permissions_stripped not in allowed_permissions:
                    self.logger.warning(
                        "Invalid permissions value '%s', defaulting to 'CC0: Public Domain'",
                        permissions_stripped,
                    )
                    sanitized_permissions = "CC0: Public Domain"
                else:
                    sanitized_permissions = permissions_stripped

            # 7. Create dataset record FIRST and add to session
            # This must be done before processing tags to avoid foreign key constraint violations
            # during autoflush when querying for existing tags
            dataset = Dataset(
                dataset_id=dataset_id,
                dataset_title=sanitized_title,
                creator=dataset_data.creator,
                dataset_description=sanitized_dataset_desc,
                organization=dataset_data.organization,
                private=dataset_private,
                approved=False,
                approved_by=None,
            )
            self.session.add(dataset)

            # 8. Process tags: normalize, create/get Tag records, create TagDataset associations
            # Now that dataset is in the session, tag processing can safely reference it
            normalized_tags = self._normalize_tags(dataset_data.tags)
            for normalized_tag in normalized_tags:
                # Check if tag exists (case-insensitive)
                tag_result = await self.session.execute(
                    select(Tag).where(func.lower(Tag.tag_name) == normalized_tag)
                )
                existing_tag = tag_result.scalar_one_or_none()

                if existing_tag:
                    tag_id = existing_tag.tag_id
                else:
                    # Create new tag
                    tag_id = uuid4()
                    new_tag = Tag(
                        tag_id=tag_id,
                        tag_name=normalized_tag,
                    )
                    self.session.add(new_tag)

                # Create TagDataset association
                tag_dataset = TagDataset(
                    dataset_id=dataset_id,
                    tag_id=tag_id,
                )
                self.session.add(tag_dataset)

            # 9. Create file record with all moved and new fields
            file = File(
                file_id=file_id,
                file_title=sanitized_filename,
                file_key=dataset_data.file_key,
                bucket=self.s3_bucket,
                file_size=file_size,
                file_description=sanitized_file_desc,
                file_format=sanitized_file_format,
                dataset_id=dataset_id,
                provenance=sanitized_provenance,
                source=sanitized_source,
                cite_as=sanitized_cite_as,
                groundtruthed=dataset_data.groundtruthed,
                permissions=sanitized_permissions,
                duration=dataset_data.duration
                if dataset_data.duration is not None
                else 0,
                value=dataset_data.value,
                temporal_from=dataset_data.temporal_from,
                temporal_to=dataset_data.temporal_to,
                geography=sanitized_geography,
            )
            self.session.add(file)
            self.session.add(
                FileDownloadCount(
                    file_id=file_id,
                    dataset_id=dataset_id,
                    downloads=0,
                )
            )

            # 10. Increment user contributions in user_contributions table (upsert: update or insert when missing)
            inc_result = await self.session.execute(
                update(UserContribution)
                .where(UserContribution.user_id == dataset_data.creator)
                .values(contributions=UserContribution.contributions + 1)
            )
            if inc_result.rowcount == 0:
                self.session.add(
                    UserContribution(
                        user_id=dataset_data.creator,
                        organization_id=dataset_data.organization,
                        contributions=1,
                    )
                )

            # 11. Commit all changes (dataset, file, tags, tag_dataset, and counters)
            await self.session.commit()
            await self.session.refresh(dataset)
            await self.session.refresh(file)

            self.logger.info(
                "Dataset and file created successfully: dataset_id=%s, file_id=%s",
                dataset_id,
                file_id,
            )

            return dataset, file

        except HTTPException:
            await self.session.rollback()
            raise
        except IntegrityError as e:
            await self.session.rollback()
            error_str = str(e).lower()

            # Check for foreign key constraint violations
            if (
                "foreign key constraint" in error_str
                or "foreign key violation" in error_str
            ):
                self.logger.exception(
                    "Foreign key constraint violation creating dataset: %s", e
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Database constraint violation occurred while creating dataset. Please try again or contact support if the issue persists.",
                )

            # Check for unique constraint violations (duplicate identifiers)
            if (
                "unique constraint" in error_str
                or "duplicate key" in error_str
                or "already exists" in error_str
            ):
                self.logger.exception(
                    "Duplicate identifier error creating dataset: %s", e
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Dataset or file with this identifier already exists",
                )

            # Generic integrity error
            self.logger.exception("Integrity error creating dataset: %s", e)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Database constraint violation: Dataset or file with this identifier may already exist",
            )
        except Exception as e:
            await self.session.rollback()
            self.logger.exception("Unexpected error creating dataset: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error creating dataset",
            )

    async def update_dataset_metadata_and_tags(
        self,
        dataset_id: UUID,
        dataset_title: str,
        dataset_description: Optional[str],
        private: bool,
        tags: List[str],
    ) -> Optional[Dataset]:
        """
        Update dataset metadata (title, description, private) and replace tags.

        Resolves tag names to Tag records (create if missing), then replaces
        all tag_dataset rows for this dataset with the new tag set.

        Args:
            dataset_id: Dataset UUID to update
            dataset_title: New title
            dataset_description: New description (optional)
            private: New private flag
            tags: List of tag name strings (normalized: strip, spaces->hyphen, lower)

        Returns:
            Updated Dataset with tags loaded, or None if dataset not found
        """
        try:
            self.logger.info(
                "Updating dataset metadata and tags for dataset_id=%s", dataset_id
            )

            sanitized_title = sanitize_input(dataset_title) or ""
            if not sanitized_title.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="dataset_title cannot be empty",
                )

            result = await self.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            dataset = result.scalar_one_or_none()
            if dataset is None:
                self.logger.info("Dataset not found: dataset_id=%s", dataset_id)
                return None

            organization = await self.get_organization_with_private_status(
                dataset.organization
            )
            dataset_private = private
            if dataset_private and not organization.private:
                self.logger.info(
                    "Dataset marked private but organization is not private. "
                    "Setting dataset private=False for org_id=%s",
                    organization.id,
                )
                dataset_private = False

            dataset.dataset_title = sanitized_title.strip()
            dataset.dataset_description = sanitize_input(dataset_description)
            dataset.private = dataset_private
            self.session.add(dataset)

            normalized_tags = self._normalize_tags(tags)

            tag_ids: List[UUID] = []
            for normalized_tag in normalized_tags:
                tag_result = await self.session.execute(
                    select(Tag).where(func.lower(Tag.tag_name) == normalized_tag)
                )
                existing_tag = tag_result.scalar_one_or_none()
                if existing_tag:
                    tag_ids.append(existing_tag.tag_id)
                else:
                    tag_id = uuid4()
                    new_tag = Tag(tag_id=tag_id, tag_name=normalized_tag)
                    self.session.add(new_tag)
                    tag_ids.append(tag_id)

            await self.session.execute(
                delete(TagDataset).where(TagDataset.dataset_id == dataset_id)
            )
            for tag_id in tag_ids:
                self.session.add(
                    TagDataset(dataset_id=dataset_id, tag_id=tag_id)
                )

            await self.session.commit()
            await self.session.refresh(dataset, ["tags"])

            self.logger.info(
                "Dataset metadata and tags updated successfully: dataset_id=%s",
                dataset_id,
            )
            return dataset

        except HTTPException:
            await self.session.rollback()
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Error updating dataset metadata/tags for dataset_id=%s: %s",
                dataset_id,
                e,
            )
            raise

    async def get_dataset_and_files(
        self, dataset_id: UUID
    ) -> Tuple[Dataset, list[File]]:
        """
        Retrieve a dataset and all of its files with eager loading of relationships.

        Args:
            dataset_id: Dataset UUID

        Returns:
            Tuple of (Dataset, List[File])

        Raises:
            HTTPException: If dataset not found or on errors
        """
        try:
            self.logger.info("Fetching dataset and files for dataset_id=%s", dataset_id)

            # Fetch dataset with eager loading of tags relationship
            result_ds = await self.session.execute(
                select(Dataset)
                .options(selectinload(Dataset.tags))
                .where(Dataset.dataset_id == dataset_id)
            )
            dataset: Dataset | None = result_ds.scalar_one_or_none()

            if dataset is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Dataset not found",
                )

            # Fetch files sorted by created_at descending (latest first)
            result_files = await self.session.execute(
                select(File)
                .where(File.dataset_id == dataset_id)
                .order_by(desc(File.created_at))
            )
            files: list[File] = list(result_files.scalars().all())

            return dataset, files

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error fetching dataset/files for %s: %s", dataset_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching dataset information",
            )

    async def dataset_exists(self, dataset_id: UUID) -> bool:
        """
        Check if a dataset exists by dataset_id.

        The except HTTPException clause is intentionally defensive to mirror
        other service methods; the code path here (session.execute/select/
        scalar_one_or_none) does not raise HTTPException.

        Args:
            dataset_id: Dataset UUID to check

        Returns:
            True if the dataset exists, False otherwise
        """
        try:
            result = await self.session.execute(
                select(Dataset.dataset_id).where(
                    Dataset.dataset_id == dataset_id
                )
            )
            return result.scalar_one_or_none() is not None
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Error checking dataset existence for dataset_id=%s: %s",
                dataset_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error checking dataset",
            )

    async def get_user_datasets(
        self,
        user_id: UUID,
        limit: int = 10,
        offset: int = 0,
        requesting_user: Optional[User] = None,
    ) -> List[Dataset]:
        """
        Get datasets created by a specific user with pagination and visibility filtering.

        Visibility rules:
        - If requester is the same as user_id (creator): return all creator datasets.
        - If requester is from same organization as creator: return creator datasets with approved=True.
        - If requester is anonymous or from different organization:
          return creator datasets with private=False and approved=True.

        Args:
            user_id: UUID of the user (creator)
            limit: Maximum number of results (default: 10)
            offset: Number of results to skip (default: 0)
            requesting_user: Optional requesting user resolved from session/apikey

        Returns:
            List of Dataset objects ordered by created_at (latest first)

        Raises:
            HTTPException: If there's an error fetching datasets
        """
        try:
            self.logger.info(
                "Fetching datasets for user_id=%s, limit=%d, offset=%d, requesting_user=%s",
                user_id,
                limit,
                offset,
                requesting_user.id if requesting_user else None,
            )

            # Build base query with eager loading of tags
            query = (
                select(Dataset)
                .options(selectinload(Dataset.tags))
                .where(Dataset.creator == user_id)
                .order_by(desc(Dataset.created_at))
            )

            # Requesting own datasets: no privacy or approval filtering.
            if requesting_user is not None and requesting_user.id == user_id:
                self.logger.debug(
                    "Requester matches creator (%s), returning all datasets without visibility filters",
                    user_id,
                )
            else:
                # Fetch creator to evaluate organization relationship.
                creator_user_result = await self.session.execute(
                    select(User).where(User.id == user_id)
                )
                creator_user: Optional[User] = creator_user_result.scalar_one_or_none()

                if creator_user is None:
                    self.logger.warning("Creator user not found: %s", user_id)
                    return []

                if (
                    requesting_user is not None
                    and requesting_user.organization == creator_user.organization
                ):
                    # Same organization, different requester: approved-only filter.
                    self.logger.debug(
                        "Same-organization requester for creator=%s, applying approved=True filter only",
                        user_id,
                    )
                    query = query.where(Dataset.approved.is_(True))
                else:
                    # Anonymous or different organization: public + approved only.
                    self.logger.debug(
                        "Anonymous/different-organization requester for creator=%s, applying private=False and approved=True filters",
                        user_id,
                    )
                    query = query.where(
                        Dataset.private.is_(False),
                        Dataset.approved.is_(True),
                    )

            # Apply pagination
            query = query.limit(limit).offset(offset)

            result = await self.session.execute(query)
            datasets: List[Dataset] = list(result.scalars().all())

            self.logger.info("Found %d datasets for user_id=%s", len(datasets), user_id)

            return datasets

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error fetching user datasets for %s: %s", user_id, e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching user datasets",
            )

    async def transfer_dataset_creator(
        self,
        admin_user: User,
        dataset_id: UUID,
        new_creator_id: UUID,
    ) -> dict[str, Any]:
        """
        Transfer dataset ownership to another user in the same organization.
        Updates datasets.creator and commits first; queues notification emails only after commit succeeds.
        """
        result = await self.session.execute(
            select(Dataset).where(Dataset.dataset_id == dataset_id)
        )
        dataset: Optional[Dataset] = result.scalar_one_or_none()
        if dataset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset not found",
            )

        if admin_user.role != 1:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to transfer dataset",
            )

        if admin_user.organization != dataset.organization:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to transfer dataset",
            )

        target_result = await self.session.execute(
            select(User).where(User.id == new_creator_id)
        )
        target_user: Optional[User] = target_result.scalar_one_or_none()
        if target_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        if target_user.organization != dataset.organization:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to transfer dataset",
            )

        old_result = await self.session.execute(
            select(User).where(User.id == dataset.creator)
        )
        old_creator: Optional[User] = old_result.scalar_one_or_none()
        if old_creator is None:
            self.logger.warning(
                "Previous dataset creator user missing: dataset_id=%s creator_id=%s",
                dataset_id,
                dataset.creator,
            )

        title = dataset.dataset_title
        admin_name = admin_user.full_name
        new_creator_name = target_user.full_name
        old_creator_id = dataset.creator

        recipient_emails: list[str] = []
        if old_creator and old_creator.email and str(old_creator.email).strip():
            recipient_emails.append(str(old_creator.email).strip())
        if target_user.email and str(target_user.email).strip():
            recipient_emails.append(str(target_user.email).strip())

        deduped_emails: list[str] = []
        seen_lower: set[str] = set()
        for addr in recipient_emails:
            key = addr.lower()
            if key in seen_lower:
                continue
            seen_lower.add(key)
            deduped_emails.append(addr)

        try:
            await self.session.execute(
                update(Dataset)
                .where(Dataset.dataset_id == dataset_id)
                .values(creator=new_creator_id)
            )
            if old_creator_id == new_creator_id:
                self.logger.debug(
                    "Dataset transfer contribution rebalance skipped: old_creator and new_creator are same dataset_id=%s user_id=%s",
                    dataset_id,
                    new_creator_id,
                )
            else:
                dec_result = await self.session.execute(
                    update(UserContribution)
                    .where(UserContribution.user_id == old_creator_id)
                    .values(
                        contributions=func.greatest(
                            UserContribution.contributions - 1, 0
                        )
                    )
                )
                if dec_result.rowcount == 0:
                    self.logger.warning(
                        "Dataset transfer contribution decrement skipped: no user_contributions row dataset_id=%s old_creator_id=%s",
                        dataset_id,
                        old_creator_id,
                    )

                inc_result = await self.session.execute(
                    update(UserContribution)
                    .where(UserContribution.user_id == new_creator_id)
                    .values(contributions=UserContribution.contributions + 1)
                )
                if inc_result.rowcount == 0:
                    self.session.add(
                        UserContribution(
                            user_id=new_creator_id,
                            organization_id=dataset.organization,
                            contributions=1,
                        )
                    )
            await self.session.commit()
        except Exception as exc:
            await self.session.rollback()
            self.logger.error(
                "transfer_dataset_creator failed during update/commit: dataset_id=%s new_creator_id=%s error=%s",
                dataset_id,
                new_creator_id,
                exc,
                exc_info=True,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error transferring dataset",
            ) from exc

        for addr in deduped_emails:
            send_dataset_transfer.apply_async(
                args=[addr, title, new_creator_name, admin_name]
            )

        self.logger.info(
            "Dataset transfer complete: dataset_id=%s new_creator=%s admin=%s",
            dataset_id,
            new_creator_id,
            admin_user.id,
        )
        return {
            "dataset_id": str(dataset_id),
            "creator": str(new_creator_id),
            "detail": "Dataset transferred successfully",
        }

    async def get_datasets(
        self,
        current_user: Optional[User] = None,
        apikey: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> List[Dataset]:
        """
        Get approved datasets with session-first auth precedence and pagination.

        If session user and apikey are both absent:
            - Returns all datasets where private=False AND approved=True
            - Sorted by created_at (latest first)

        If session user is present OR apikey is provided:
            - Resolves user from session first; if no session, falls back to apikey
            - Gets user's organization UUID
            - Returns datasets where approved=True AND
              (private=False OR organization=user's organization)
            - Sorted by created_at (latest first)

        Args:
            current_user: Optional authenticated user from session cookie
            apikey: Optional API key fallback when session user is unavailable
            limit: Maximum number of results (default: 10)
            offset: Number of results to skip (default: 0)

        Returns:
            List of Dataset objects ordered by created_at (latest first)

        Raises:
            HTTPException: If there's an error fetching datasets or invalid apikey
        """
        try:
            sanitized_apikey = apikey.strip() if apikey and apikey.strip() else None
            resolved_user: Optional[User] = current_user
            auth_source = "session" if current_user else "anonymous"

            if resolved_user is None and sanitized_apikey:
                auth_source = "apikey"
                user_result = await self.session.execute(
                    select(User).where(User.apikey == sanitized_apikey)
                )
                resolved_user = user_result.scalar_one_or_none()
                if resolved_user is None:
                    self.logger.warning("User not found for provided apikey")
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Invalid API key",
                    )

            self.logger.info(
                "Fetching datasets: auth_source=%s, apikey=%s, limit=%d, offset=%d",
                auth_source,
                "provided" if sanitized_apikey else "not provided",
                limit,
                offset,
            )

            # Build base query with eager loading of tags
            query = (
                select(Dataset)
                .options(selectinload(Dataset.tags))
                .where(Dataset.approved.is_(True))
                .order_by(desc(Dataset.created_at))
            )

            # Apply filtering based on resolved user (session first, then apikey fallback)
            if resolved_user is None:
                self.logger.debug(
                    "No authenticated requester, filtering private=False and approved=True"
                )
                query = query.where(Dataset.private.is_(False))
            else:
                self.logger.debug(
                    "Authenticated requester resolved from %s: user_id=%s, organization=%s",
                    auth_source,
                    resolved_user.id,
                    resolved_user.organization,
                )

                # Filter: private=False OR organization=user's organization
                query = query.where(
                    or_(
                        Dataset.private.is_(False),
                        Dataset.organization == resolved_user.organization,
                    )
                )

            # Apply pagination
            query = query.limit(limit).offset(offset)

            result = await self.session.execute(query)
            datasets: List[Dataset] = list(result.scalars().all())

            self.logger.info(
                "Found %d datasets (auth_source=%s, apikey=%s, limit=%d, offset=%d)",
                len(datasets),
                auth_source,
                "provided" if sanitized_apikey else "not provided",
                limit,
                offset,
            )

            return datasets

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error fetching datasets: auth_source=%s, apikey=%s, error=%s",
                "session" if current_user else ("apikey" if apikey else "anonymous"),
                "provided" if apikey else "not provided",
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching datasets",
            )


async def get_dataset_service(
    session: AsyncSession = Depends(get_session),
    org_service: OrganizationService = Depends(get_organization_service),
    upload_service: UploadService = Depends(get_upload_service),
    user_service: UserService = Depends(get_user_service),
) -> DatasetService:
    """
    Dependency function to get DatasetService instance.

    Args:
        session: Database session
        org_service: Organization service
        upload_service: Upload service
        user_service: User service

    Returns:
        DatasetService instance
    """
    return DatasetService(session, org_service, upload_service, user_service)
