"""
Dataset router for handling dataset creation.
"""

import logging
from uuid import UUID

from core.config import settings
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.dataset import Dataset
from models.file import File
from models.user import User
from routers.upload import get_current_active_user
from schemas.dataset import DatasetCreate
from services.auth import AuthService, RedisStrategy, get_auth_service
from services.dataset import DatasetService, get_dataset_service
from services.organization import OrganizationService, get_organization_service
from utils.security import sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)


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
                    "author": dataset.author,
                    "source_url": dataset.source_url,
                    "cite_as": dataset.cite_as,
                    "groundtruthed": dataset.groundtruthed,
                    "private": dataset.private,
                    "downloads": dataset.downloads,
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


# Route handlers
@router.post("/create_dataset")
async def create_dataset(
    title: str = Form(..., description="Dataset title"),
    creator: str = Form(..., description="Creator user ID (UUID)"),
    dataset_description: str | None = Form(None, description="Dataset description"),
    tags: str | None = Form(None, description="Tags for the dataset"),
    organization: str = Form(..., description="Organization ID"),
    author: str | None = Form(None, description="Author name"),
    source_url: str | None = Form(None, description="Source URL"),
    cite_as: str | None = Form(None, description="Citation information"),
    groundtruthed: bool | None = Form(None, description="Whether dataset is groundtruthed"),
    private: bool = Form(False, description="Whether dataset is private"),
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
        author: Author name (optional, max 125 chars)
        source_url: Source URL (optional, max 1000 chars)
        cite_as: Citation information (optional, max 1500 chars)
        groundtruthed: Whether dataset is groundtruthed (optional)
        private: Whether dataset is private (default: False)
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

        # Create DatasetCreate schema from form data
        dataset_data = DatasetCreate(
            title=title,
            creator=creator_uuid,
            dataset_description=dataset_description,
            tags=tags,
            organization=organization,
            author=author,
            source_url=source_url,
            cite_as=cite_as,
            groundtruthed=groundtruthed,
            private=private,
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
    except Exception as e:
        logger.exception("Unexpected error in create_dataset endpoint: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing dataset creation request",
        )

