"""
Dataset service for handling dataset and file creation.
"""

import logging
import re
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID, uuid4

from core.availability import (
    clamp_availability_for_org,
    viewer_can_see_dataset,
    approved_dataset_visibility_clause,
    AVAILABILITY_PUBLIC,
)
from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.dataset_owner import DatasetOwner
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
from sqlalchemy import delete, desc, exists, func, select, update
from tasks.email import send_dataset_transfer
from utils.security import mask_apikey
from services.typesense_index import DEFAULT_TAG_TOPIC, safe_index_dataset, safe_upsert_tag
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from utils.security import sanitize_input

logger = logging.getLogger(__name__)


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

    async def _get_or_create_tag(self, normalized_tag: str) -> Tag:
        """Return existing tag by name, or create one with topic=NA."""
        tag_result = await self.session.execute(
            select(Tag).where(func.lower(Tag.tag_name) == normalized_tag)
        )
        existing_tag = tag_result.scalar_one_or_none()
        if existing_tag:
            return existing_tag
        new_tag = Tag(
            tag_id=uuid4(),
            tag_name=normalized_tag,
            topic=DEFAULT_TAG_TOPIC,
        )
        self.session.add(new_tag)
        await safe_upsert_tag(new_tag.tag_id, new_tag.tag_name, new_tag.topic)
        return new_tag

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
                tag = await self._get_or_create_tag(normalized_tag)
                self.session.add(
                    TagDataset(dataset_id=dataset_id, tag_id=tag.tag_id),
                )
        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "attach_tags_to_dataset failed for dataset_id=%s: %s", dataset_id, e
            )
            raise

    async def get_organization_names(self, org_ids: List[Any]) -> Dict[str, str]:
        """Map organization UUIDs to display names."""
        unique_ids = []
        seen = set()
        for org_id in org_ids:
            if org_id is None:
                continue
            try:
                coerced = OrganizationService.coerce_org_id(org_id)
            except (ValueError, TypeError, AttributeError):
                continue
            key = str(coerced)
            if key in seen:
                continue
            seen.add(key)
            unique_ids.append(coerced)
        if not unique_ids:
            return {}
        result = await self.session.execute(
            select(Organization.id, Organization.name).where(
                Organization.id.in_(unique_ids)
            )
        )
        return {str(row[0]): row[1] for row in result.all()}

    async def get_user_names(self, user_ids: List[Any]) -> Dict[str, str]:
        """Map user UUIDs to display names."""
        unique_ids = []
        seen = set()
        for user_id in user_ids:
            if user_id is None:
                continue
            key = str(user_id)
            if key in seen:
                continue
            seen.add(key)
            unique_ids.append(user_id)
        if not unique_ids:
            return {}
        result = await self.session.execute(
            select(User.id, User.full_name).where(User.id.in_(unique_ids))
        )
        return {str(row[0]): row[1] for row in result.all()}

    async def list_item_payloads(self, datasets: List[Dataset]) -> List[Dict[str, Any]]:
        """Shared list/card fields for dataset rows (creator, org, tags, downloads)."""
        if not datasets:
            return []
        dataset_ids = [ds.dataset_id for ds in datasets]
        download_totals = await self.get_download_totals_for_datasets(dataset_ids)
        file_counts: Dict[UUID, int] = {did: 0 for did in dataset_ids}
        count_result = await self.session.execute(
            select(File.dataset_id, func.count(File.file_id))
            .where(File.dataset_id.in_(dataset_ids))
            .group_by(File.dataset_id)
        )
        for row in count_result.all():
            file_counts[row[0]] = int(row[1])
        org_names = await self.get_organization_names(
            [ds.organization for ds in datasets]
        )
        creator_names = await self.get_user_names([ds.creator for ds in datasets])
        payloads = []
        for ds in datasets:
            payloads.append(
                {
                    "dataset_id": str(ds.dataset_id),
                    "dataset_title": ds.dataset_title,
                    "creator": str(ds.creator),
                    "creator_name": creator_names.get(str(ds.creator)),
                    "created_at": ds.created_at.isoformat() if ds.created_at else None,
                    "organization": ds.organization,
                    "organization_name": org_names.get(str(ds.organization)),
                    "availability": ds.availability,
                    "downloads": download_totals.get(ds.dataset_id, 0),
                    "file_count": file_counts.get(ds.dataset_id, 0),
                    "dataset_description": ds.dataset_description,
                    "tags": [tag.tag_name for tag in (ds.tags or [])],
                    "approved": ds.approved,
                    "approved_by": str(ds.approved_by) if ds.approved_by else None,
                }
            )
        return payloads

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
        2. Check if user is a dataset owner
        3. Check if user is org admin (role == 1) AND belongs to dataset's organization
        4. Check if user is superuser
        Reviewers (role == 2) do not get delete via this helper.

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
            masked_apikey = mask_apikey(apikey)
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
        user_data = await self.user_service.get_user_by_apikey(apikey)
        if user_data is None:
            return False
        return await self._check_dataset_permission_by_user_id(
            user_data["id"], dataset_id
        )

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
        if await self.is_dataset_owner(user_id, dataset_id):
            self.logger.info(
                "Permission granted: user %s is owner of dataset %s",
                user_id,
                dataset_id,
            )
            return True
        ds_result = await self.session.execute(
            select(Dataset.organization).where(Dataset.dataset_id == dataset_id)
        )
        org_id = ds_result.scalar_one_or_none()
        if org_id and await self.user_service.check_if_admin_by_id(org_id, user_id):
            self.logger.info(
                "Permission granted: user %s is org admin for dataset %s",
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

    async def is_dataset_owner(self, user_id: UUID, dataset_id: UUID) -> bool:
        result = await self.session.execute(
            select(DatasetOwner).where(
                DatasetOwner.dataset_id == dataset_id,
                DatasetOwner.user_id == user_id,
            )
        )
        return result.scalar_one_or_none() is not None

    async def viewer_can_see(self, dataset: Dataset, viewer: Optional[User]) -> bool:
        is_owner = False
        if viewer is not None:
            is_owner = await self.is_dataset_owner(viewer.id, dataset.dataset_id)
        return viewer_can_see_dataset(
            availability=dataset.availability,
            dataset_organization=dataset.organization,
            creator_id=dataset.creator,
            viewer=viewer,
            is_owner=is_owner,
        )

    async def can_edit_or_add_file(self, user_id: UUID, dataset_id: UUID) -> bool:
        is_creator = await self.user_service.check_if_dataset_creator_by_id(
            user_id, dataset_id
        )
        if is_creator:
            return True
        return await self.is_dataset_owner(user_id, dataset_id)

    async def list_owners(self, dataset_id: UUID) -> List[Dict[str, Any]]:
        result = await self.session.execute(
            select(DatasetOwner, User)
            .join(User, User.id == DatasetOwner.user_id)
            .where(DatasetOwner.dataset_id == dataset_id)
            .order_by(DatasetOwner.added_at.asc())
        )
        rows = result.all()
        owners: List[Dict[str, Any]] = []
        for owner_row, user in rows:
            owners.append(
                {
                    "user_id": str(user.id),
                    "full_name": user.full_name,
                    "email": user.email,
                    "added_at": owner_row.added_at.isoformat()
                    if owner_row.added_at
                    else None,
                    "added_by": str(owner_row.added_by) if owner_row.added_by else None,
                }
            )
        return owners

    async def seed_creator_as_owner(
        self, dataset_id: UUID, creator_id: UUID, added_by: Optional[UUID] = None
    ) -> None:
        existing = await self.session.execute(
            select(DatasetOwner).where(
                DatasetOwner.dataset_id == dataset_id,
                DatasetOwner.user_id == creator_id,
            )
        )
        if existing.scalar_one_or_none() is not None:
            return
        self.session.add(
            DatasetOwner(
                dataset_id=dataset_id,
                user_id=creator_id,
                added_by=added_by,
            )
        )

    async def _can_manage_owners(self, actor: User, dataset: Dataset) -> bool:
        if actor.is_superuser:
            return True
        if await self.is_dataset_owner(actor.id, dataset.dataset_id):
            return True
        return await self.user_service.check_if_admin_by_id(
            dataset.organization, actor.id
        )

    async def add_owner(
        self, actor: User, dataset_id: UUID, target_user_id: UUID
    ) -> dict[str, Any]:
        result = await self.session.execute(
            select(Dataset).where(Dataset.dataset_id == dataset_id)
        )
        dataset: Optional[Dataset] = result.scalar_one_or_none()
        if dataset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        if not await self._can_manage_owners(actor, dataset):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to manage dataset owners",
            )
        target_result = await self.session.execute(
            select(User).where(User.id == target_user_id)
        )
        target_user: Optional[User] = target_result.scalar_one_or_none()
        if target_user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
            )
        if (
            not actor.is_superuser
            and target_user.organization != dataset.organization
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Owner must belong to the dataset organization",
            )
        if await self.is_dataset_owner(target_user_id, dataset_id):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User is already an owner",
            )
        self.session.add(
            DatasetOwner(
                dataset_id=dataset_id,
                user_id=target_user_id,
                added_by=actor.id,
            )
        )
        await self.session.commit()
        await safe_index_dataset(self.session, dataset_id)
        if target_user.email and str(target_user.email).strip():
            send_dataset_transfer.apply_async(
                args=[
                    str(target_user.email).strip(),
                    dataset.dataset_title,
                    target_user.full_name,
                    actor.full_name,
                ]
            )
        return {
            "dataset_id": str(dataset_id),
            "user_id": str(target_user_id),
            "detail": "Owner added successfully",
        }

    async def remove_owner(
        self, actor: User, dataset_id: UUID, target_user_id: UUID
    ) -> dict[str, Any]:
        result = await self.session.execute(
            select(Dataset).where(Dataset.dataset_id == dataset_id)
        )
        dataset: Optional[Dataset] = result.scalar_one_or_none()
        if dataset is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found"
            )
        if not await self._can_manage_owners(actor, dataset):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Unauthorized to manage dataset owners",
            )
        if dataset.creator == target_user_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot remove the dataset creator from owners",
            )
        delete_result = await self.session.execute(
            delete(DatasetOwner).where(
                DatasetOwner.dataset_id == dataset_id,
                DatasetOwner.user_id == target_user_id,
            )
        )
        if delete_result.rowcount == 0:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Owner not found",
            )
        await self.session.commit()
        await safe_index_dataset(self.session, dataset_id)
        return {
            "dataset_id": str(dataset_id),
            "user_id": str(target_user_id),
            "detail": "Owner removed successfully",
        }

    async def create_dataset_with_file(
        self, dataset_data: DatasetCreate, current_user: User
    ) -> Tuple[Dataset, File]:
        """
        Create a dataset and its associated file record.

        This method:
        1. Validates creator matches authenticated user
        2. Validates organization exists
        3. Validates file exists in S3
        4. Applies availability logic
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

            dataset_availability = clamp_availability_for_org(
                dataset_data.availability, organization.private
            )

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
                availability=dataset_availability,
                approved=False,
                approved_by=None,
            )
            self.session.add(dataset)
            await self.seed_creator_as_owner(
                dataset_id, dataset_data.creator, added_by=dataset_data.creator
            )

            # 8. Process tags: normalize, create/get Tag records, create TagDataset associations
            # Now that dataset is in the session, tag processing can safely reference it
            normalized_tags = self._normalize_tags(dataset_data.tags)
            for normalized_tag in normalized_tags:
                tag = await self._get_or_create_tag(normalized_tag)
                tag_dataset = TagDataset(
                    dataset_id=dataset_id,
                    tag_id=tag.tag_id,
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
            await safe_index_dataset(self.session, dataset_id)

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
        availability: int,
        tags: List[str],
    ) -> Optional[Dataset]:
        """
        Update dataset metadata (title, description, availability) and replace tags.

        Resolves tag names to Tag records (create if missing), then replaces
        all tag_dataset rows for this dataset with the new tag set.

        Args:
            dataset_id: Dataset UUID to update
            dataset_title: New title
            dataset_description: New description (optional)
            availability: Visibility level 0–4
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
            dataset.dataset_title = sanitized_title.strip()
            dataset.dataset_description = sanitize_input(dataset_description)
            dataset.availability = clamp_availability_for_org(
                availability, organization.private
            )
            self.session.add(dataset)

            normalized_tags = self._normalize_tags(tags)

            tag_ids: List[UUID] = []
            for normalized_tag in normalized_tags:
                tag = await self._get_or_create_tag(normalized_tag)
                tag_ids.append(tag.tag_id)

            await self.session.execute(
                delete(TagDataset).where(TagDataset.dataset_id == dataset_id)
            )
            for tag_id in tag_ids:
                self.session.add(
                    TagDataset(dataset_id=dataset_id, tag_id=tag_id)
                )

            await self.session.commit()
            await self.session.refresh(dataset, ["tags"])
            await safe_index_dataset(self.session, dataset_id)

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

    async def _user_datasets_query(
        self,
        user_id: UUID,
        requesting_user: Optional[User],
        scope: str,
    ):
        """Build a dataset listing query for a user. None means empty result."""
        is_self = requesting_user is not None and requesting_user.id == user_id
        normalized = (scope or "created").strip().lower()
        if normalized not in {"created", "published", "pending", "owned"}:
            normalized = "created"

        if normalized == "owned":
            if not is_self:
                return None
            return (
                select(Dataset)
                .options(selectinload(Dataset.tags))
                .join(
                    DatasetOwner,
                    DatasetOwner.dataset_id == Dataset.dataset_id,
                )
                .where(DatasetOwner.user_id == user_id)
                .order_by(desc(Dataset.created_at))
            )

        query = (
            select(Dataset)
            .options(selectinload(Dataset.tags))
            .where(Dataset.creator == user_id)
            .order_by(desc(Dataset.created_at))
        )
        if normalized == "published":
            query = query.where(Dataset.approved.is_(True))
        elif normalized == "pending":
            if not is_self:
                return None
            query = query.where(Dataset.approved.is_(False))

        if is_self:
            return query

        creator_user_result = await self.session.execute(
            select(User).where(User.id == user_id)
        )
        creator_user: Optional[User] = creator_user_result.scalar_one_or_none()
        if creator_user is None:
            return None
        return query.where(
            Dataset.approved.is_(True),
            approved_dataset_visibility_clause(requesting_user),
        )

    async def _count_user_datasets(
        self,
        user_id: UUID,
        requesting_user: Optional[User],
        scope: str,
    ) -> int:
        """Count rows for a dashboard scope without eager-loading entities."""
        is_self = requesting_user is not None and requesting_user.id == user_id
        normalized = (scope or "created").strip().lower()
        if normalized not in {"created", "published", "pending", "owned"}:
            normalized = "created"

        if normalized == "owned":
            if not is_self:
                return 0
            result = await self.session.scalar(
                select(func.count())
                .select_from(DatasetOwner)
                .where(DatasetOwner.user_id == user_id)
            )
            return int(result or 0)

        conditions = [Dataset.creator == user_id]
        if normalized == "published":
            conditions.append(Dataset.approved.is_(True))
        elif normalized == "pending":
            if not is_self:
                return 0
            conditions.append(Dataset.approved.is_(False))

        query = select(func.count()).select_from(Dataset).where(*conditions)
        if not is_self:
            query = (
                select(func.count())
                .select_from(Dataset)
                .where(
                    Dataset.creator == user_id,
                    Dataset.approved.is_(True),
                    approved_dataset_visibility_clause(requesting_user),
                )
            )
        result = await self.session.scalar(query)
        return int(result or 0)

    async def get_user_dataset_counts(
        self,
        user_id: UUID,
        requesting_user: Optional[User] = None,
    ) -> Dict[str, int]:
        """Counts for the logged-in user's dashboard tabs. Other users only get published."""
        is_self = requesting_user is not None and requesting_user.id == user_id
        published = await self._count_user_datasets(
            user_id, requesting_user, "published"
        )
        pending = (
            await self._count_user_datasets(user_id, requesting_user, "pending")
            if is_self
            else 0
        )
        owned = (
            await self._count_user_datasets(user_id, requesting_user, "owned")
            if is_self
            else 0
        )
        return {"published": published, "pending": pending, "owned": owned}

    async def get_user_datasets(
        self,
        user_id: UUID,
        limit: int = 10,
        offset: int = 0,
        requesting_user: Optional[User] = None,
        scope: str = "created",
    ) -> Tuple[List[Dataset], int]:
        """
        Get datasets created or owned by a user, with pagination and visibility filtering.

        Visibility rules:
        - If requester is the same as user_id: return their created/owned datasets
          according to scope (created, published, pending, owned).
        - Otherwise: return only approved datasets the viewer may see. Pending and
          owned scopes are empty for other users.
        """
        try:
            self.logger.info(
                "Fetching datasets for user_id=%s, limit=%d, offset=%d, requesting_user=%s, scope=%s",
                user_id,
                limit,
                offset,
                requesting_user.id if requesting_user else None,
                scope,
            )
            query = await self._user_datasets_query(user_id, requesting_user, scope)
            if query is None:
                return [], 0

            total = await self._count_user_datasets(user_id, requesting_user, scope)
            result = await self.session.execute(query.limit(limit).offset(offset))
            datasets: List[Dataset] = list(result.scalars().all())
            self.logger.info("Found %d datasets for user_id=%s", len(datasets), user_id)
            return datasets, total

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

    async def get_datasets(
        self,
        current_user: Optional[User] = None,
        apikey: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
        topic: Optional[str] = None,
        return_total: bool = False,
    ):
        """
        Get approved datasets with session-first auth precedence and pagination.

        When return_total is True, returns a (datasets, total) tuple where total
        is the number of datasets matching the same filters before pagination.

        If session user and apikey are both absent:
            - Returns all datasets where availability=0 AND approved=True
            - Sorted by created_at (latest first)

        If session user is present OR apikey is provided:
            - Resolves user from session first; if no session, falls back to apikey
            - Returns approved datasets the viewer may see given availability
              (public, org, admins, owners, or creator)
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
                query = query.where(Dataset.availability == AVAILABILITY_PUBLIC)
            else:
                query = query.where(
                    approved_dataset_visibility_clause(resolved_user)
                )

            topic_filter = (topic or "").strip()
            if topic_filter:
                query = query.where(
                    exists(
                        select(1)
                        .select_from(TagDataset)
                        .join(Tag, Tag.tag_id == TagDataset.tag_id)
                        .where(TagDataset.dataset_id == Dataset.dataset_id)
                        .where(func.lower(Tag.topic) == topic_filter.lower())
                    )
                )

            total: Optional[int] = None
            if return_total:
                count_query = select(func.count()).select_from(
                    query.order_by(None).subquery()
                )
                total = int((await self.session.execute(count_query)).scalar_one() or 0)

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

            if return_total:
                return datasets, total
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
