"""
Dataset service for handling dataset and file creation.
"""

import logging
import re
from typing import List, Optional, Tuple
from uuid import UUID, uuid4

from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.file import File
from models.organization import Organization
from models.tag import Tag
from models.tag_dataset import TagDataset
from models.user import User
from schemas.dataset import DatasetCreate
from services.organization import OrganizationService, get_organization_service
from services.upload import UploadService, get_upload_service
from sqlalchemy import desc, func, or_, select, update
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
    ):
        self.session = session
        self.org_service = org_service
        self.upload_service = upload_service
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
            if permissions_value is None or (isinstance(permissions_value, str) and not permissions_value.strip()):
                sanitized_permissions = "CC0: Public Domain"
            else:
                permissions_stripped = permissions_value.strip() if isinstance(permissions_value, str) else str(permissions_value).strip()
                if permissions_stripped not in allowed_permissions:
                    self.logger.warning(
                        "Invalid permissions value '%s', defaulting to 'CC0: Public Domain'",
                        permissions_stripped
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
                downloads=0,
                approved=False,
                approved_by=None,
            )
            self.session.add(dataset)

            # 8. Process tags: normalize, create/get Tag records, create TagDataset associations
            # Now that dataset is in the session, tag processing can safely reference it
            if dataset_data.tags:
                for tag_str in dataset_data.tags:
                    # Strip whitespace
                    tag_stripped = tag_str.strip()
                    if not tag_stripped:
                        continue
                    
                    # Normalize: replace spaces with hyphens, convert to lowercase
                    normalized_tag = re.sub(r"\s+", "-", tag_stripped).lower()
                    
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
                downloads=0,
                provenance=sanitized_provenance,
                source=sanitized_source,
                cite_as=sanitized_cite_as,
                groundtruthed=dataset_data.groundtruthed,
                permissions=sanitized_permissions,
                duration=dataset_data.duration if dataset_data.duration is not None else 0,
                value=dataset_data.value,
                temporal_from=dataset_data.temporal_from,
                temporal_to=dataset_data.temporal_to,
                geography=sanitized_geography,
            )
            self.session.add(file)

            # 10. Increment contributions for user and organization
            await self.session.execute(
                update(User)
                .where(User.id == dataset_data.creator)
                .values(contributions=User.contributions + 1)
            )
            await self.session.execute(
                update(Organization)
                .where(Organization.id == dataset_data.organization)
                .values(contributions=Organization.contributions + 1)
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
            if "foreign key constraint" in error_str or "foreign key violation" in error_str:
                self.logger.exception("Foreign key constraint violation creating dataset: %s", e)
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Database constraint violation occurred while creating dataset. Please try again or contact support if the issue persists.",
                )
            
            # Check for unique constraint violations (duplicate identifiers)
            if "unique constraint" in error_str or "duplicate key" in error_str or "already exists" in error_str:
                self.logger.exception("Duplicate identifier error creating dataset: %s", e)
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

            # Fetch files
            result_files = await self.session.execute(
                select(File).where(File.dataset_id == dataset_id)
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

    async def get_user_datasets(
        self,
        user_id: UUID,
        limit: int = 10,
        offset: int = 0,
        authenticated_user: Optional[User] = None,
    ) -> List[Dataset]:
        """
        Get datasets created by a specific user with pagination and privacy filtering.

        Privacy rules:
        - If not authenticated: return only public datasets (private=False)
        - If authenticated:
          - If authenticated user's organization matches creator's organization:
            return all datasets (no privacy filter)
          - If organizations don't match: return only public datasets (private=False)

        Args:
            user_id: UUID of the user (creator)
            limit: Maximum number of results (default: 10)
            offset: Number of results to skip (default: 0)
            authenticated_user: Optional authenticated user for privacy filtering

        Returns:
            List of Dataset objects ordered by created_at (latest first)

        Raises:
            HTTPException: If there's an error fetching datasets
        """
        try:
            self.logger.info(
                "Fetching datasets for user_id=%s, limit=%d, offset=%d, authenticated=%s",
                user_id,
                limit,
                offset,
                authenticated_user.id if authenticated_user else None,
            )

            # Build base query with eager loading of tags
            query = (
                select(Dataset)
                .options(selectinload(Dataset.tags))
                .where(Dataset.creator == user_id)
                .order_by(desc(Dataset.created_at))
            )

            # Apply privacy filtering based on authentication and organization match
            if authenticated_user is None:
                # Not authenticated: only public datasets
                self.logger.debug("User not authenticated, filtering private=False")
                query = query.where(Dataset.private.is_(False))
            else:
                # Authenticated: check organization match
                # Fetch the creator's user record to get their organization
                creator_user_result = await self.session.execute(
                    select(User).where(User.id == user_id)
                )
                creator_user: Optional[User] = creator_user_result.scalar_one_or_none()

                if creator_user is None:
                    self.logger.warning("Creator user not found: %s", user_id)
                    # Creator doesn't exist, return empty list
                    return []

                # Compare organizations
                authenticated_org = authenticated_user.organization
                creator_org = creator_user.organization

                if authenticated_org != creator_org:
                    # Organizations don't match: only public datasets
                    self.logger.debug(
                        "Organizations don't match (auth: %s, creator: %s), filtering private=False",
                        authenticated_org,
                        creator_org,
                    )
                    query = query.where(Dataset.private.is_(False))
                else:
                    # Organizations match: return all datasets (no privacy filter)
                    self.logger.debug(
                        "Organizations match (%s), returning all datasets",
                        authenticated_org,
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

    async def get_datasets(
        self,
        apikey: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> List[Dataset]:
        """
        Get datasets with optional API key filtering and pagination.

        If apikey is not provided:
            - Returns all datasets where private=False
            - Sorted by created_at (latest first)

        If apikey is provided:
            - Finds user by apikey
            - Gets user's organization UUID
            - Returns datasets where (private=False OR organization=user's organization)
            - Sorted by created_at (latest first)

        Args:
            apikey: Optional API key to filter by user's organization
            limit: Maximum number of results (default: 10)
            offset: Number of results to skip (default: 0)

        Returns:
            List of Dataset objects ordered by created_at (latest first)

        Raises:
            HTTPException: If there's an error fetching datasets or invalid apikey
        """
        try:
            self.logger.info(
                "Fetching datasets: apikey=%s, limit=%d, offset=%d",
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            # Build base query with eager loading of tags
            query = select(Dataset).options(selectinload(Dataset.tags)).order_by(desc(Dataset.created_at))

            # Apply filtering based on apikey
            if apikey is None:
                # No apikey: only public datasets
                self.logger.debug("No apikey provided, filtering private=False")
                query = query.where(Dataset.private.is_(False))
            else:
                # Apikey provided: find user and get organization
                user_result = await self.session.execute(
                    select(User).where(User.apikey == apikey)
                )
                user: Optional[User] = user_result.scalar_one_or_none()

                if user is None:
                    self.logger.warning("User not found for provided apikey")
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail="Invalid API key",
                    )

                # Get user's organization UUID
                user_organization = user.organization
                self.logger.debug(
                    "User found for apikey: user_id=%s, organization=%s",
                    user.id,
                    user_organization,
                )

                # Filter: private=False OR organization=user's organization
                query = query.where(
                    or_(
                        Dataset.private.is_(False),
                        Dataset.organization == user_organization,
                    )
                )

            # Apply pagination
            query = query.limit(limit).offset(offset)

            result = await self.session.execute(query)
            datasets: List[Dataset] = list(result.scalars().all())

            self.logger.info(
                "Found %d datasets (apikey=%s, limit=%d, offset=%d)",
                len(datasets),
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            return datasets

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error fetching datasets: apikey=%s, error=%s",
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
) -> DatasetService:
    """
    Dependency function to get DatasetService instance.

    Args:
        session: Database session
        org_service: Organization service
        upload_service: Upload service

    Returns:
        DatasetService instance
    """
    return DatasetService(session, org_service, upload_service)
