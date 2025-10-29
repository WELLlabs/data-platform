"""
Upload router for handling file upload URL generation.
"""

import logging
from uuid import UUID

from core.config import settings
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.user import User
from services.auth import AuthService, RedisStrategy, get_auth_service
from services.upload import UploadService, get_upload_service
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
    ):
        self.upload_service = upload_service
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


# Dependency to get upload controller
async def get_upload_controller(
    upload_service: UploadService = Depends(get_upload_service),
) -> UploadController:
    """
    Dependency function to get UploadController instance.
    
    Args:
        upload_service: Upload service dependency
        
    Returns:
        UploadController instance
    """
    return UploadController(upload_service)


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

