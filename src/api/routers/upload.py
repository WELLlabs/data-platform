"""
Upload router for handling file upload URL generation.
"""

import logging
from typing import Optional
from uuid import UUID

from core.config import settings
from db.session import get_session
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.dataset import Dataset
from models.file import File
from models.user import User
from services.auth import AuthService, RedisStrategy, get_auth_service
from services.upload import UploadService, get_upload_service
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)


async def get_current_active_user(
    request: Request, auth_service: AuthService = Depends(get_auth_service)
) -> User:
    """
    Dependency function to get the current authenticated and active user.
    
    Args:
        request: FastAPI request object to access cookies
        auth_service: Authentication service dependency
        
    Returns:
        User model instance of the authenticated user
        
    Raises:
        HTTPException: If user is not authenticated or not active
    """
    try:
        # Get the session token from cookies
        session_token = request.cookies.get(settings.COOKIE_NAME)
        if not session_token:
            logger.warning("Upload request attempted without authentication token")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required",
            )

        # Verify the session token with Redis
        strategy = RedisStrategy(
            auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS
        )
        user_id = await strategy.read_token(session_token)

        if not user_id:
            logger.warning("Upload request attempted with invalid or expired session")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired session",
            )

        # Get user from database
        user = await auth_service.user_db.get(UUID(user_id))
        if not user:
            logger.warning("User not found for ID: %s", user_id)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found",
            )

        # Check if user is active
        if not user.is_active:
            logger.warning("Inactive user attempted upload: %s", user_id)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is not active",
            )

        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error authenticating user for upload: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Authentication service error",
        )


class UploadController:
    """
    Class-based upload controller with comprehensive error handling and security.
    """

    def __init__(
        self,
        upload_service: UploadService,
        session: AsyncSession,
    ):
        self.upload_service = upload_service
        self.session = session
        self.logger = logging.getLogger(__name__)

    async def get_upload_url(
        self, filename: str, user: User
    ) -> JSONResponse:
        """
        Get presigned upload URL for a file.
        
        This method:
        1. Validates the filename
        2. Checks if the file already exists
        3. Generates a presigned URL if file doesn't exist
        
        Args:
            filename: Name of the file to upload
            user: Authenticated user making the request
            
        Returns:
            JSONResponse containing presigned URL information
            
        Raises:
            HTTPException: If validation fails or service error occurs
        """
        try:
            # Sanitize and validate filename
            sanitized_filename = sanitize_input(filename)
            if not sanitized_filename or not sanitized_filename.strip():
                self.logger.warning(
                    "Invalid filename provided by user %s: %s", user.id, filename
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid filename",
                )

            # Remove any path components for security (prevent directory traversal)
            sanitized_filename = sanitized_filename.split("/")[-1].split("\\")[-1]
            
            if not sanitized_filename:
                self.logger.warning(
                    "Empty filename after sanitization for user %s", user.id
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Filename cannot be empty",
                )

            self.logger.info(
                "Processing upload URL request for user %s, filename: %s",
                user.id,
                sanitized_filename,
            )

            # Check if file already exists
            file_status = await self.upload_service.check_file_exists(
                user.id, sanitized_filename
            )

            if file_status.get("exists", False):
                self.logger.warning(
                    "File already exists: %s/%s", user.id, sanitized_filename
                )
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="File already exists",
                )

            # Get presigned upload URL
            presigned_data = await self.upload_service.get_presigned_upload_url(
                user.id, sanitized_filename
            )

            self.logger.info(
                "Presigned URL generated successfully for user %s, filename: %s",
                user.id,
                sanitized_filename,
            )

            return JSONResponse(
                content=jsonable_encoder(presigned_data),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error generating upload URL for user %s: %s",
                user.id if user else "unknown",
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating upload URL",
            )

    async def get_download_url(
        self, file_key: str, file_id: Optional[UUID] = None
    ) -> JSONResponse:
        """
        Get presigned download URL for a file.
        
        This method:
        1. Validates the file_key
        2. Checks if the file exists in S3
        3. If file_id is provided, increments download counters in database
        4. Generates a presigned download URL if file exists
        
        Args:
            file_key: S3 file key (e.g., "user_id/filename")
            file_id: Optional file ID to track downloads in database
            
        Returns:
            JSONResponse containing presigned download URL information
            
        Raises:
            HTTPException: If validation fails or service error occurs
        """
        try:
            # Sanitize and validate file_key
            sanitized_file_key = sanitize_input(file_key)
            if not sanitized_file_key or not sanitized_file_key.strip():
                self.logger.warning("Invalid file_key provided: %s", file_key)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid file_key",
                )

            self.logger.info(
                "Processing download URL request for file_key: %s, file_id: %s",
                sanitized_file_key,
                file_id,
            )

            # Check if file exists
            file_status = await self.upload_service.check_file_status_by_key(
                sanitized_file_key
            )

            if not file_status.get("exists", False):
                self.logger.warning("File does not exist: %s", sanitized_file_key)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File does not exist",
                )

            # If file_id is provided, increment download counters
            if file_id is not None:
                try:
                    # Get file record to retrieve dataset_id
                    result = await self.session.execute(
                        select(File).where(File.file_id == file_id)
                    )
                    file_record = result.scalar_one_or_none()

                    if not file_record:
                        self.logger.warning(
                            "File record not found for file_id: %s", file_id
                        )
                        raise HTTPException(
                            status_code=status.HTTP_404_NOT_FOUND,
                            detail="File record not found",
                        )

                    dataset_id = file_record.dataset_id

                    # Increment downloads in files table
                    await self.session.execute(
                        update(File)
                        .where(File.file_id == file_id)
                        .values(downloads=File.downloads + 1)
                    )

                    # Increment downloads in datasets table
                    await self.session.execute(
                        update(Dataset)
                        .where(Dataset.dataset_id == dataset_id)
                        .values(downloads=Dataset.downloads + 1)
                    )

                    # Commit the changes
                    await self.session.commit()

                    self.logger.info(
                        "Download counters incremented for file_id: %s, dataset_id: %s",
                        file_id,
                        dataset_id,
                    )
                except HTTPException:
                    await self.session.rollback()
                    raise
                except Exception as e:
                    await self.session.rollback()
                    self.logger.exception(
                        "Error incrementing download counters for file_id %s: %s",
                        file_id,
                        e,
                    )
                    # Don't fail the request if counter increment fails, just log it
                    self.logger.warning(
                        "Continuing with download URL generation despite counter increment error"
                    )

            # Get presigned download URL
            presigned_data = await self.upload_service.get_presigned_download_url(
                sanitized_file_key
            )

            self.logger.info(
                "Presigned download URL generated successfully for file_key: %s",
                sanitized_file_key,
            )

            return JSONResponse(
                content=jsonable_encoder(presigned_data),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error generating download URL for file_key %s: %s",
                file_key,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating download URL",
            )


# Dependency to get upload controller
async def get_upload_controller(
    upload_service: UploadService = Depends(get_upload_service),
    session: AsyncSession = Depends(get_session),
) -> UploadController:
    """
    Dependency function to get UploadController instance.
    
    Args:
        upload_service: Upload service dependency
        session: Database session dependency
        
    Returns:
        UploadController instance
    """
    return UploadController(upload_service, session)


# Route handlers
@router.get("/upload_url")
async def get_upload_url(
    filename: str = Query(..., description="Name of the file to upload"),
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Get a presigned URL for uploading a file to S3.
    
    This endpoint:
    - Requires authentication (valid session cookie)
    - Checks if the user is active
    - Validates that the file doesn't already exist
    - Returns a presigned URL for uploading the file
    
    Args:
        filename: Name of the file with extension
        user: Authenticated user (from dependency)
        controller: Upload controller (from dependency)
        
    Returns:
        JSON response containing presigned URL information
        
    Raises:
        HTTPException:
            - 401: Not authenticated
            - 403: User account not active
            - 400: Invalid filename
            - 409: File already exists
            - 500: Internal server error
            - 502: S3 handler service unavailable
            - 504: S3 handler service timeout
    """
    return await controller.get_upload_url(filename, user)


@router.get("/download_url")
async def get_download_url(
    file_key: str = Query(..., description="S3 file key (e.g., 'user_id/filename')"),
    file_id: Optional[UUID] = Query(
        None, description="Optional file ID to track downloads in database"
    ),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Get a presigned URL for downloading a file from S3.
    
    This endpoint:
    - Takes a file_key as required query parameter
    - Takes an optional file_id query parameter
    - Checks if the file exists in S3 using the /status endpoint
    - If file_id is provided, increments download counters in files and datasets tables
    - Returns a presigned download URL if file exists
    
    Args:
        file_key: S3 file key (e.g., "user_id/filename")
        file_id: Optional file ID to track downloads in database
        controller: Upload controller (from dependency)
        
    Returns:
        JSON response containing presigned download URL information
        
    Raises:
        HTTPException:
            - 400: Invalid file_key
            - 404: File does not exist or file record not found
            - 500: Internal server error
            - 502: S3 handler service unavailable
            - 504: S3 handler service timeout
    """
    return await controller.get_download_url(file_key, file_id)

