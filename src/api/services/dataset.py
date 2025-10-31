"""
Dataset service for handling dataset and file creation.
"""

import logging
from typing import List, Optional, Tuple
from uuid import UUID, uuid4

from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.file import File
from models.organization import Organization
from models.user import User
from schemas.dataset import DatasetCreate
from services.organization import OrganizationService, get_organization_service
from services.upload import UploadService, get_upload_service
from sqlalchemy import desc, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
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
        5. Creates dataset record
        6. Creates file record

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
            sanitized_tags = sanitize_input(dataset_data.tags)
            sanitized_author = sanitize_input(dataset_data.author)
            sanitized_source_url = sanitize_input(dataset_data.source_url)
            sanitized_cite_as = sanitize_input(dataset_data.cite_as)
            sanitized_filename = sanitize_input(dataset_data.filename) or ""
            sanitized_file_desc = sanitize_input(dataset_data.file_description)
            sanitized_file_format = sanitize_input(dataset_data.file_format)

            # 7. Create dataset record
            dataset = Dataset(
                dataset_id=dataset_id,
                dataset_title=sanitized_title,
                creator=dataset_data.creator,
                dataset_description=sanitized_dataset_desc,
                tags=sanitized_tags,
                organization=dataset_data.organization,
                author=sanitized_author,
                source_url=sanitized_source_url,
                cite_as=sanitized_cite_as,
                groundtruthed=dataset_data.groundtruthed,
                private=dataset_private,
                downloads=0,
            )

            # 8. Create file record
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
            )

            # 9. Add to session
            self.session.add(dataset)
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

            # 11. Commit all changes (dataset, file, and counters)
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
            self.logger.exception("Integrity error creating dataset: %s", e)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Dataset or file with this identifier already exists",
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
        Retrieve a dataset and all of its files.

        Args:
            dataset_id: Dataset UUID

        Returns:
            Tuple of (Dataset, List[File])

        Raises:
            HTTPException: If dataset not found or on errors
        """
        try:
            self.logger.info("Fetching dataset and files for dataset_id=%s", dataset_id)

            # Fetch dataset
            result_ds = await self.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
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

            # Build base query
            query = (
                select(Dataset)
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
