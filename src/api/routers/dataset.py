"""
Dataset router for handling dataset creation.
"""

import logging
import re
from typing import Optional
from uuid import UUID

from core.config import settings
from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.user import User
from routers.upload import get_current_active_user
from schemas.dataset import DatasetCreate
from services.auth import AuthService, RedisStrategy, get_auth_service
from services.dataset import DatasetService, get_dataset_service
from services.organization import OrganizationService, get_organization_service

router = APIRouter()
logger = logging.getLogger(__name__)


async def get_current_active_user_optional(
    request: Request, auth_service: AuthService = Depends(get_auth_service)
) -> Optional[User]:
    """
    Optional dependency function to get the current authenticated and active user.
    Returns None if user is not authenticated (instead of raising an exception).

    Args:
        request: FastAPI request object to access cookies
        auth_service: Authentication service dependency

    Returns:
        User model instance if authenticated and active, None otherwise
    """
    try:
        # Get the session token from cookies
        session_token = request.cookies.get(settings.COOKIE_NAME)
        if not session_token:
            return None

        # Verify the session token with Redis
        strategy = RedisStrategy(auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS)
        user_id = await strategy.read_token(session_token)

        if not user_id:
            return None

        # Get user from database
        user = await auth_service.user_db.get(UUID(user_id))
        if not user:
            return None

        # Check if user is active
        if not user.is_active:
            return None

        return user

    except Exception as e:
        logger.debug("Optional authentication check failed: %s", e)
        return None


class DatasetController:
    """
    Class-based dataset controller with comprehensive error handling and security.
    """

    def __init__(self, dataset_service: DatasetService):
        self.dataset_service = dataset_service
        self.logger = logging.getLogger(__name__)

    async def create_dataset(
        self, dataset_data: DatasetCreate, user: User
    ) -> JSONResponse:
        """
        Create a dataset with associated file record.

        Args:
            dataset_data: Dataset creation data from form
            user: Authenticated user making the request

        Returns:
            JSONResponse containing created dataset and file information

        Raises:
            HTTPException: If validation fails or creation fails
        """
        try:
            self.logger.info(
                "Processing dataset creation request for user %s, title: %s",
                user.id,
                dataset_data.title,
            )

            # Create dataset and file
            dataset, file = await self.dataset_service.create_dataset_with_file(
                dataset_data, user
            )

            # Prepare response data
            response_data = {
                "dataset": {
                    "dataset_id": str(dataset.dataset_id),
                    "title": dataset.dataset_title,
                    "creator": str(dataset.creator),
                    "description": dataset.dataset_description,
                    "tags": dataset.tags,
                    "organization": dataset.organization,
                    "provenance": dataset.provenance,
                    "source": dataset.source,
                    "cite_as": dataset.cite_as,
                    "groundtruthed": dataset.groundtruthed,
                    "private": dataset.private,
                    "downloads": dataset.downloads,
                    "approved": dataset.approved,
                    "approved_by": str(dataset.approved_by)
                    if dataset.approved_by
                    else None,
                    "permissions": dataset.permissions,
                    "duration": dataset.duration,
                    "value": dataset.value,
                    "created_at": dataset.created_at.isoformat()
                    if dataset.created_at
                    else None,
                },
                "file": {
                    "file_id": str(file.file_id),
                    "filename": file.file_title,
                    "file_key": file.file_key,
                    "bucket": file.bucket,
                    "file_size": file.file_size,
                    "file_description": file.file_description,
                    "file_format": file.file_format,
                    "dataset_id": str(file.dataset_id),
                    "downloads": file.downloads,
                    "created_at": file.created_at.isoformat()
                    if file.created_at
                    else None,
                },
            }

            self.logger.info(
                "Dataset created successfully: dataset_id=%s, file_id=%s",
                dataset.dataset_id,
                file.file_id,
            )

            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_201_CREATED,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error creating dataset for user %s: %s",
                user.id if user else "unknown",
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error creating dataset",
            )

    async def get_dataset_info(self, dataset_id: UUID) -> JSONResponse:
        """
        Get dataset and associated files by dataset_id.
        """
        try:
            self.logger.info("Fetching dataset info for %s", dataset_id)

            dataset, files = await self.dataset_service.get_dataset_and_files(
                dataset_id
            )

            dataset_obj = {
                "dataset_id": str(dataset.dataset_id),
                "dataset_title": dataset.dataset_title,
                "creator": str(dataset.creator),
                "created_at": dataset.created_at.isoformat()
                if dataset.created_at
                else None,
                "organization": dataset.organization,
                "private": dataset.private,
                "downloads": dataset.downloads,
                "dataset_description": dataset.dataset_description,
                "tags": dataset.tags,
                "provenance": dataset.provenance,
                "source": dataset.source,
                "cite_as": dataset.cite_as,
                "groundtruthed": dataset.groundtruthed,
                "approved": dataset.approved,
                "approved_by": str(dataset.approved_by)
                if dataset.approved_by
                else None,
                "permissions": dataset.permissions,
                "duration": dataset.duration,
                "value": dataset.value,
            }

            files_arr = [
                {
                    "file_id": str(f.file_id),
                    "file_title": f.file_title,
                    "file_key": f.file_key,
                    "bucket": f.bucket,
                    "file_size": f.file_size,
                    "file_description": f.file_description,
                    "file_format": f.file_format,
                    "dataset_id": str(f.dataset_id),
                    "downloads": f.downloads,
                    "created_at": f.created_at.isoformat() if f.created_at else None,
                }
                for f in files
            ]

            return JSONResponse(
                content=jsonable_encoder({"dataset": dataset_obj, "files": files_arr}),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error in dataset info: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching dataset information",
            )

    async def get_user_datasets(
        self,
        user_id: UUID,
        limit: int,
        offset: int,
        authenticated_user: Optional[User] = None,
    ) -> JSONResponse:
        """
        Get datasets created by a specific user with pagination and privacy filtering.

        Args:
            user_id: UUID of the user (creator)
            limit: Maximum number of results
            offset: Number of results to skip
            authenticated_user: Optional authenticated user for privacy filtering

        Returns:
            JSONResponse containing list of datasets
        """
        try:
            self.logger.info(
                "Fetching user datasets for user_id=%s, limit=%d, offset=%d, authenticated=%s",
                user_id,
                limit,
                offset,
                authenticated_user.id if authenticated_user else None,
            )

            datasets = await self.dataset_service.get_user_datasets(
                user_id, limit, offset, authenticated_user
            )

            datasets_arr = [
                {
                    "dataset_id": str(ds.dataset_id),
                    "dataset_title": ds.dataset_title,
                    "creator": str(ds.creator),
                    "created_at": ds.created_at.isoformat() if ds.created_at else None,
                    "organization": ds.organization,
                    "private": ds.private,
                    "downloads": ds.downloads,
                    "dataset_description": ds.dataset_description,
                    "tags": ds.tags,
                    "provenance": ds.provenance,
                    "source": ds.source,
                    "cite_as": ds.cite_as,
                    "groundtruthed": ds.groundtruthed,
                    "approved": ds.approved,
                    "approved_by": str(ds.approved_by) if ds.approved_by else None,
                    "permissions": ds.permissions,
                    "duration": ds.duration,
                    "value": ds.value,
                }
                for ds in datasets
            ]

            return JSONResponse(
                content=jsonable_encoder(datasets_arr),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error in get_user_datasets: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching user datasets",
            )

    async def get_datasets(
        self,
        apikey: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
    ) -> JSONResponse:
        """
        Get datasets with optional API key filtering and pagination.

        Args:
            apikey: Optional API key to filter by user's organization
            limit: Maximum number of results (default: 10)
            offset: Number of results to skip (default: 0)

        Returns:
            JSONResponse containing list of datasets
        """
        try:
            self.logger.info(
                "Fetching datasets: apikey=%s, limit=%d, offset=%d",
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            datasets = await self.dataset_service.get_datasets(
                apikey=apikey, limit=limit, offset=offset
            )

            datasets_arr = [
                {
                    "dataset_id": str(ds.dataset_id),
                    "dataset_title": ds.dataset_title,
                    "creator": str(ds.creator),
                    "created_at": ds.created_at.isoformat() if ds.created_at else None,
                    "organization": ds.organization,
                    "private": ds.private,
                    "downloads": ds.downloads,
                    "dataset_description": ds.dataset_description,
                    "tags": ds.tags,
                    "provenance": ds.provenance,
                    "source": ds.source,
                    "cite_as": ds.cite_as,
                    "groundtruthed": ds.groundtruthed,
                    "approved": ds.approved,
                    "approved_by": str(ds.approved_by) if ds.approved_by else None,
                    "permissions": ds.permissions,
                    "duration": ds.duration,
                    "value": ds.value,
                }
                for ds in datasets
            ]

            self.logger.info(
                "Successfully fetched %d datasets (apikey=%s, limit=%d, offset=%d)",
                len(datasets_arr),
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            return JSONResponse(
                content=jsonable_encoder(datasets_arr),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error in get_datasets: apikey=%s, error=%s",
                "provided" if apikey else "not provided",
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error fetching datasets",
            )


# Dependency to get dataset controller
async def get_dataset_controller(
    dataset_service: DatasetService = Depends(get_dataset_service),
) -> DatasetController:
    """
    Dependency function to get DatasetController instance.

    Args:
        dataset_service: Dataset service dependency

    Returns:
        DatasetController instance
    """
    return DatasetController(dataset_service)


def process_tags(tags: str | None) -> str | None:
    """
    Process tags string by:
    1. Splitting by comma
    2. Stripping whitespace from each tag
    3. Replacing spaces within tags with hyphens
    4. Converting to lowercase
    5. Joining back with commas

    Example:
        "Open, Cold blooded, data , store, Cloud Model, test "
        -> "open,cold-blooded,data,store,cloud-model,test"

    Args:
        tags: Tags string (comma-separated) or None

    Returns:
        Processed tags string or None if input is None/empty
    """
    if not tags or not tags.strip():
        return None

    # Split by comma, strip whitespace, filter out empty strings
    tag_list = [tag.strip() for tag in tags.split(",") if tag.strip()]

    if not tag_list:
        return None

    # Process each tag: replace one or more spaces with a single hyphen and convert to lowercase
    processed_tags = [re.sub(r"\s+", "-", tag).lower() for tag in tag_list]

    # Join back with commas
    return ",".join(processed_tags)


# Route handlers
@router.post("/create_dataset")
async def create_dataset(
    title: str = Form(..., description="Dataset title"),
    creator: str = Form(..., description="Creator user ID (UUID)"),
    dataset_description: str | None = Form(None, description="Dataset description"),
    tags: str | None = Form(None, description="Tags for the dataset"),
    organization: str = Form(..., description="Organization ID"),
    provenance: str | None = Form(None, description="Provenance"),
    source: str | None = Form(None, description="Source"),
    cite_as: str | None = Form(None, description="Citation information"),
    groundtruthed: bool | None = Form(
        None, description="Whether dataset is groundtruthed"
    ),
    private: bool = Form(False, description="Whether dataset is private"),
    permissions: str | None = Form(None, description="Permissions"),
    duration: int = Form(0, description="Duration in years"),
    value: str | None = Form(None, description="Value level (high, medium, low)"),
    filename: str = Form(..., description="File name"),
    file_key: str = Form(..., description="S3 file key"),
    file_description: str | None = Form(None, description="File description"),
    file_format: str | None = Form(None, description="File format/extension"),
    user: User = Depends(get_current_active_user),
    controller: DatasetController = Depends(get_dataset_controller),
    org_service: OrganizationService = Depends(get_organization_service),
):
    """
    Create a dataset with associated file record.

    This endpoint:
    - Requires authentication (valid session cookie)
    - Checks if the user is active and valid
    - Validates that the organization exists in the organization table
    - Validates that file exists in S3
    - Creates records in both datasets and files tables

    Args:
        title: Dataset title
        creator: Creator user ID (UUID)
        dataset_description: Dataset description (optional)
        tags: Tags for the dataset (optional, max 500 chars)
        organization: Organization ID
        provenance: Provenance (optional, max 125 chars)
        source: Source (optional, max 1000 chars)
        cite_as: Citation information (optional, validated to 1500 chars)
        groundtruthed: Whether dataset is groundtruthed (optional)
        private: Whether dataset is private (default: False)
        permissions: Permissions (optional, max 1000 chars)
        duration: Duration in years (default: 0)
        value: Value level - high, medium, or low (optional)
        filename: File name
        file_key: S3 file key
        file_description: File description (optional)
        file_format: File format/extension (optional, max 20 chars)
        user: Authenticated user (from dependency)
        controller: Dataset controller (from dependency)
        org_service: Organization service (from dependency)

    Returns:
        JSON response containing created dataset and file information

    Raises:
        HTTPException:
            - 401: Not authenticated
            - 403: User account not active or creator mismatch
            - 404: Organization not found or file doesn't exist in S3
            - 409: Dataset/file already exists
            - 500: Internal server error
            - 502: S3 handler service unavailable
            - 504: S3 handler service timeout
    """
    try:
        # Parse creator UUID
        try:
            creator_uuid = UUID(creator)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid creator UUID format",
            )

        # Validate organization exists
        logger.info("Validating organization exists: %s", organization)
        org_exists = await org_service.validate_organization_id(organization)
        if not org_exists:
            logger.warning(
                "Organization not found during dataset creation: %s (user: %s)",
                organization,
                user.id,
            )
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Organization '{organization}' not found",
            )

        # Process tags: normalize format (lowercase, replace spaces with hyphens, strip whitespace)
        processed_tags = process_tags(tags)
        logger.debug(
            "Tags processing: original='%s', processed='%s'", tags, processed_tags
        )

        # Create DatasetCreate schema from form data
        dataset_data = DatasetCreate(
            title=title,
            creator=creator_uuid,
            dataset_description=dataset_description,
            tags=processed_tags,
            organization=organization,
            provenance=provenance,
            source=source,
            cite_as=cite_as,
            groundtruthed=groundtruthed,
            private=private,
            permissions=permissions,
            duration=duration,
            value=value,
            filename=filename,
            file_key=file_key,
            file_description=file_description,
            file_format=file_format,
        )

        return await controller.create_dataset(dataset_data, user)

    except HTTPException:
        raise
    except ValueError as e:
        logger.exception("Validation error in create_dataset: %s", e)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid input data: {str(e)}",
        )


@router.get("/dataset_info")
async def dataset_info(
    dataset_id: str,
    controller: DatasetController = Depends(get_dataset_controller),
):
    """
    Get dataset info and associated files by dataset_id (query parameter).
    """
    try:
        try:
            ds_uuid = UUID(dataset_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid dataset_id UUID format",
            )

        return await controller.get_dataset_info(ds_uuid)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /dataset-info: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing dataset info request",
        )


@router.get("/user_datasets")
async def user_datasets(
    user_id: str = Query(..., description="User ID (UUID)"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    controller: DatasetController = Depends(get_dataset_controller),
    authenticated_user: Optional[User] = Depends(get_current_active_user_optional),
):
    """
    Get datasets created by a specific user with pagination and privacy filtering.

    Privacy rules:
    - If not authenticated: returns only public datasets (private=False)
    - If authenticated:
      - If authenticated user's organization matches creator's organization:
        returns all datasets (no privacy filter)
      - If organizations don't match: returns only public datasets (private=False)

    Args:
        user_id: User ID (UUID) - required query parameter (creator of datasets)
        limit: Maximum number of results (default: 10, min: 1, max: 100)
        offset: Number of results to skip for pagination (default: 0, min: 0)
        controller: Dataset controller (from dependency)
        authenticated_user: Optional authenticated user (from dependency)

    Returns:
        JSON response containing list of datasets ordered by created_at (latest first)

    Raises:
        HTTPException:
            - 400: Invalid user_id UUID format
            - 500: Internal server error
    """
    try:
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user_id UUID format",
            )

        return await controller.get_user_datasets(
            user_uuid, limit, offset, authenticated_user
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /user_datasets: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing user datasets request",
        )


@router.get("/datasets")
async def datasets(
    apikey: Optional[str] = Query(
        None, description="Optional API key for organization filtering"
    ),
    limit: int = Query(10, ge=1, le=50, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    controller: DatasetController = Depends(get_dataset_controller),
):
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
        limit: Maximum number of results (default: 10, min: 1, max: 50)
        offset: Number of results to skip for pagination (default: 0, min: 0)
        controller: Dataset controller (from dependency)

    Returns:
        JSON response containing list of datasets ordered by created_at (latest first)

    Raises:
        HTTPException:
            - 404: Invalid API key (when apikey is provided but not found)
            - 500: Internal server error
    """
    try:
        return await controller.get_datasets(apikey=apikey, limit=limit, offset=offset)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /datasets: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing datasets request",
        )
