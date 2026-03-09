"""
Upload router for handling file upload URL generation.
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID, uuid4

import httpx
from core.config import settings
from db.session import get_session
from fastapi import (
    APIRouter,
    Body,
    Depends,
    Form,
    HTTPException,
    Query,
    Request,
    status,
)
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.dataset import Dataset
from models.file import File
from models.user import User
from schemas.file import FileEditRequest
from services.auth import AuthService, RedisStrategy, get_auth_service
from services.dataset import DatasetService, get_dataset_service
from services.upload import UploadService, get_upload_service
from services.user import UserService, get_user_service
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)

ALLOWED_PERMISSIONS = [
    "CC0: Public Domain",
    "CC BY: Attribution",
    "CC BY-SA: Attribution-ShareAlike",
    "CC BY-NC: Attribution-NonCommercial",
    "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
    "CC BY-ND: Attribution-NoDerivatives",
    "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
]


def _validate_permissions(
    permissions: Optional[str], log: logging.Logger
) -> str:
    """Normalize permissions to an allowed CC license or default to CC0."""
    sanitized = sanitize_input(permissions)
    if sanitized is None or not sanitized.strip():
        return "CC0: Public Domain"
    stripped = sanitized.strip()
    if stripped not in ALLOWED_PERMISSIONS:
        log.warning(
            "Invalid permissions value '%s', defaulting to 'CC0: Public Domain'",
            stripped,
        )
        return "CC0: Public Domain"
    return stripped


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
        strategy = RedisStrategy(auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS)
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
        dataset_service: DatasetService,
        user_service: UserService,
    ):
        self.upload_service = upload_service
        self.session = session
        self.dataset_service = dataset_service
        self.user_service = user_service
        self.logger = logging.getLogger(__name__)

    async def get_upload_url(self, filename: str, user: User) -> JSONResponse:
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

    async def add_file(
        self,
        file_title: str,
        file_key: str,
        file_description: Optional[str],
        file_format: Optional[str],
        dataset_id: UUID,
        groundtruthed: Optional[bool],
        provenance: Optional[str],
        source: Optional[str],
        cite_as: Optional[str],
        permissions: Optional[str],
        duration: int,
        value: Optional[str],
        temporal_from: Optional[datetime],
        temporal_to: Optional[datetime],
        geography: Optional[str],
        user: User,
    ) -> JSONResponse:
        """
        Add a new file record to the files table.

        This method:
        1. Validates the dataset_id exists
        2. Checks if the file exists in S3
        3. Gets file size from S3 response
        4. Creates a new file record in the database

        Args:
            file_title: Title of the file
            file_key: S3 file key
            file_description: Optional file description
            file_format: Optional file format/extension
            dataset_id: UUID of the dataset this file belongs to

        Returns:
            JSONResponse containing created file information

        Raises:
            HTTPException: If validation fails or creation fails
        """
        try:
            # Sanitize and validate inputs
            sanitized_file_title = sanitize_input(file_title)
            if not sanitized_file_title or not sanitized_file_title.strip():
                self.logger.warning("Invalid file_title provided: %s", file_title)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid file_title",
                )

            sanitized_file_key = sanitize_input(file_key)
            if not sanitized_file_key or not sanitized_file_key.strip():
                self.logger.warning("Invalid file_key provided: %s", file_key)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid file_key",
                )

            # Sanitize optional fields
            sanitized_file_description = (
                sanitize_input(file_description) if file_description else None
            )
            sanitized_file_format = sanitize_input(file_format) if file_format else None

            # Validate file_format length if provided
            if sanitized_file_format and len(sanitized_file_format) > 20:
                self.logger.warning(
                    "File format too long: %s (max 20 chars)", sanitized_file_format
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File format must be 20 characters or less",
                )

            self.logger.info(
                "Processing add_file request for dataset_id: %s, file_key: %s",
                dataset_id,
                sanitized_file_key,
            )

            # 1. Validate dataset_id exists in database
            result = await self.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            dataset = result.scalar_one_or_none()

            if not dataset:
                self.logger.warning("Dataset not found: %s", dataset_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Dataset not found",
                )

            # 1.5. Authorization check: verify user is the dataset creator
            if dataset.creator != user.id:
                self.logger.warning(
                    "Unauthorized file addition attempt: user=%s, dataset_creator=%s, dataset_id=%s",
                    user.id,
                    dataset.creator,
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only the dataset creator can add files to this dataset",
                )

            # 2. Check if file exists in S3 and get file size
            file_status = await self.upload_service.check_file_status_by_key(
                sanitized_file_key
            )

            if not file_status.get("exists", False):
                self.logger.warning("File does not exist in S3: %s", sanitized_file_key)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File does not exist in S3",
                )

            # Get file size from S3 response
            file_size = file_status.get("size", 0)
            if file_size is None:
                file_size = 0

            self.logger.info(
                "File validated in S3: key=%s, size=%d", sanitized_file_key, file_size
            )

            # 3. Sanitize and validate additional fields
            sanitized_provenance = sanitize_input(provenance)
            if sanitized_provenance and len(sanitized_provenance) > 125:
                self.logger.warning(
                    "Provenance truncated for file_key=%s (length %d, max 125)",
                    sanitized_file_key,
                    len(sanitized_provenance),
                )
                sanitized_provenance = sanitized_provenance[:125]
            sanitized_source = sanitize_input(source)
            if sanitized_source and len(sanitized_source) > 1000:
                self.logger.warning(
                    "Source truncated for file_key=%s (length %d, max 1000)",
                    sanitized_file_key,
                    len(sanitized_source),
                )
                sanitized_source = sanitized_source[:1000]
            sanitized_cite_as = sanitize_input(cite_as)
            sanitized_geography = sanitize_input(geography)

            sanitized_permissions = _validate_permissions(
                permissions, self.logger
            )

            # Validate duration (default to 0 if None)
            duration_value = duration if duration is not None else 0

            # Validate value (must be "high", "medium", or "low"; invalid defaults to "low")
            val = sanitize_input(value)
            stripped_value = val.strip() if val else None
            if stripped_value not in ["high", "medium", "low"]:
                if stripped_value:
                    self.logger.warning(
                        "Invalid value '%s', defaulting to 'low'", stripped_value
                    )
                stripped_value = "low"

            # Validate temporal range
            if temporal_to is not None and temporal_from is not None:
                if temporal_to < temporal_from:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="temporal_to must be after temporal_from",
                    )

            # 4. Generate UUID for file_id
            file_id = uuid4()

            # 5. Create File record with all fields
            # Note: created_at uses server_default=func.now() in the model,
            # but we'll set it explicitly to avoid any deprecation warnings
            new_file = File(
                file_id=file_id,
                file_title=sanitized_file_title,
                file_key=sanitized_file_key,
                file_description=sanitized_file_description,
                file_format=sanitized_file_format,
                dataset_id=dataset_id,
                file_size=file_size,
                downloads=0,
                bucket=settings.S3_BUCKET,
                created_at=datetime.now(timezone.utc),
                provenance=sanitized_provenance,
                source=sanitized_source,
                cite_as=sanitized_cite_as,
                groundtruthed=groundtruthed,
                permissions=sanitized_permissions,
                duration=duration_value,
                value=stripped_value,
                temporal_from=temporal_from,
                temporal_to=temporal_to,
                geography=sanitized_geography,
            )

            # Add to session and commit
            self.session.add(new_file)
            await self.session.commit()
            await self.session.refresh(new_file)

            self.logger.info(
                "File record created successfully: file_id=%s, dataset_id=%s",
                file_id,
                dataset_id,
            )

            # Prepare response data
            response_data = {
                "file_id": str(new_file.file_id),
                "file_title": new_file.file_title,
                "file_key": new_file.file_key,
                "file_description": new_file.file_description,
                "file_format": new_file.file_format,
                "dataset_id": str(new_file.dataset_id),
                "file_size": new_file.file_size,
                "downloads": new_file.downloads,
                "bucket": new_file.bucket,
                "provenance": new_file.provenance,
                "source": new_file.source,
                "cite_as": new_file.cite_as,
                "groundtruthed": new_file.groundtruthed,
                "permissions": new_file.permissions,
                "duration": new_file.duration,
                "value": new_file.value,
                "temporal_from": new_file.temporal_from.isoformat()
                if new_file.temporal_from
                else None,
                "temporal_to": new_file.temporal_to.isoformat()
                if new_file.temporal_to
                else None,
                "geography": new_file.geography,
                "created_at": new_file.created_at.isoformat()
                if new_file.created_at
                else None,
            }

            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_201_CREATED,
            )

        except HTTPException:
            await self.session.rollback()
            raise
        except IntegrityError as e:
            await self.session.rollback()
            self.logger.exception("Integrity error creating file: %s", e)
            # Check if it's a duplicate file_key error
            if "file_key" in str(e).lower() or "unique" in str(e).lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="File with this key already exists",
                )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="File record already exists or constraint violation",
            )
        except Exception as e:
            await self.session.rollback()
            self.logger.exception("Unexpected error creating file record: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error creating file record",
            )

    async def delete_file(self, file_id: UUID, apikey: str) -> JSONResponse:
        """
        Delete a file from S3 and the database.

        This method:
        1. Gets the file record to retrieve dataset_id and file_key
        2. Checks permission using check_dataset_permission
        3. Checks if this is the only file in the dataset (prevents deletion if so)
        4. Deletes the file from S3
        5. Deletes the file record from the database

        Args:
            file_id: UUID of the file to delete
            apikey: API key of the user requesting deletion

        Returns:
            JSONResponse with success or error message

        Raises:
            HTTPException: If validation fails or deletion fails
        """
        try:
            self.logger.info(
                "Processing delete_file request for file_id: %s, apikey: %s",
                file_id,
                apikey,
            )

            # 1. Get file record
            result = await self.session.execute(
                select(File).where(File.file_id == file_id)
            )
            file_record = result.scalar_one_or_none()

            if not file_record:
                self.logger.warning("File not found: %s", file_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"file {file_id} does not exist",
                )

            dataset_id = file_record.dataset_id
            file_key = file_record.file_key

            # 2. Check permission
            has_permission = await self.dataset_service.check_dataset_permission(
                apikey, dataset_id
            )

            if not has_permission:
                self.logger.warning(
                    "Permission denied for file deletion: file_id=%s, apikey=%s",
                    file_id,
                    apikey,
                )
                return JSONResponse(
                    content={
                        "detail": "user does not have permission to control this dataset"
                    },
                    status_code=status.HTTP_403_FORBIDDEN,
                )

            # 2.5. Check if this is the only file in the dataset
            file_count_result = await self.session.execute(
                select(func.count(File.file_id)).where(File.dataset_id == dataset_id)
            )
            file_count = file_count_result.scalar_one()

            if file_count == 1:
                self.logger.warning(
                    "Deletion prevented: file_id=%s is the only file in dataset_id=%s",
                    file_id,
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Delete failed as this is the only file of the dataset",
                )

            # 3. Delete from S3
            s3_handler_url = settings.S3_HANDLER_URL.rstrip("/")
            s3_region = settings.S3_REGION
            s3_bucket = settings.S3_BUCKET

            params = {
                "key": file_key,
                "s3_region": s3_region,
                "s3_bucket": s3_bucket,
            }

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.delete(
                        f"{s3_handler_url}/delete",
                        params=params,
                    )

                    if response.status_code != 200:
                        self.logger.error(
                            "S3 handler delete endpoint returned status %d: %s",
                            response.status_code,
                            response.text,
                        )
                        raise HTTPException(
                            status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="S3 handler service unavailable",
                        )

                    data = response.json()
                    deleted = data.get("deleted", False)

                    if not deleted:
                        self.logger.warning(
                            "File deletion failed in S3: file_id=%s, file_key=%s",
                            file_id,
                            file_key,
                        )
                        return JSONResponse(
                            content={"detail": f"file {file_id} does not exist"},
                            status_code=status.HTTP_404_NOT_FOUND,
                        )

            except httpx.TimeoutException:
                self.logger.exception("Timeout while deleting file from S3")
                raise HTTPException(
                    status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                    detail="S3 handler service timeout",
                )
            except httpx.RequestError as e:
                self.logger.exception(
                    "Request error while deleting file from S3: %s", e
                )
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="S3 handler service connection error",
                )

            # 4. Delete from database
            await self.session.execute(delete(File).where(File.file_id == file_id))
            await self.session.commit()

            self.logger.info("File deleted successfully: file_id=%s", file_id)

            return JSONResponse(
                content={"detail": "file deleted successfully."},
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            await self.session.rollback()
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception("Unexpected error deleting file: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error deleting file",
            )

    async def edit_file(
        self,
        file_id: UUID,
        file_title: str,
        file_description: Optional[str],
        provenance: Optional[str],
        source: Optional[str],
        cite_as: Optional[str],
        groundtruthed: Optional[bool],
        permissions: Optional[str],
        duration: int,
        value: Optional[str],
        temporal_from: Optional[datetime],
        temporal_to: Optional[datetime],
        geography: Optional[str],
        user: User,
    ) -> JSONResponse:
        """
        Update file metadata. Only the dataset creator may edit.

        This method:
        1. Loads the file by file_id and gets dataset_id
        2. Checks if the current user is the dataset creator
        3. Updates the file record with the provided metadata fields
        """
        try:
            self.logger.info(
                "Processing edit_file request for file_id=%s, user=%s",
                file_id,
                user.id,
            )

            result = await self.session.execute(
                select(File).where(File.file_id == file_id)
            )
            file_record = result.scalar_one_or_none()

            if not file_record:
                self.logger.warning("File not found: %s", file_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="File not found",
                )

            dataset_id = file_record.dataset_id
            is_creator = await self.user_service.check_if_dataset_creator_by_id(
                user.id, dataset_id
            )
            if not is_creator:
                self.logger.warning(
                    "Edit denied: user %s is not creator of dataset %s",
                    user.id,
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only creator of dataset can edit.",
                )

            sanitized_title = sanitize_input(file_title)
            if not sanitized_title or not sanitized_title.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="file_title cannot be empty",
                )

            file_record.file_title = sanitized_title.strip()
            file_record.file_description = sanitize_input(file_description)
            prov = sanitize_input(provenance)
            if prov and len(prov) > 125:
                self.logger.warning(
                    "Provenance truncated for file_id=%s (length %d, max 125)",
                    file_id,
                    len(prov),
                )
                prov = prov[:125]
            file_record.provenance = prov if prov else None
            src = sanitize_input(source)
            if src and len(src) > 1000:
                self.logger.warning(
                    "Source truncated for file_id=%s (length %d, max 1000)",
                    file_id,
                    len(src),
                )
                src = src[:1000]
            file_record.source = src if src else None
            file_record.cite_as = sanitize_input(cite_as)
            file_record.groundtruthed = groundtruthed

            file_record.permissions = _validate_permissions(
                permissions, self.logger
            )

            file_record.duration = max(0, duration)

            val = sanitize_input(value)
            stripped = val.strip() if val else None
            if stripped not in ["high", "medium", "low"]:
                if stripped:
                    self.logger.warning(
                        "Invalid value '%s', defaulting to 'low'", stripped
                    )
                stripped = "low"
            file_record.value = stripped
            file_record.temporal_from = temporal_from
            file_record.temporal_to = temporal_to
            file_record.geography = sanitize_input(geography)

            self.session.add(file_record)
            await self.session.commit()
            await self.session.refresh(file_record)

            self.logger.info("File updated successfully: file_id=%s", file_id)

            response_data = {
                "file_id": str(file_record.file_id),
                "file_title": file_record.file_title,
                "file_description": file_record.file_description,
                "provenance": file_record.provenance,
                "source": file_record.source,
                "cite_as": file_record.cite_as,
                "groundtruthed": file_record.groundtruthed,
                "permissions": file_record.permissions,
                "duration": file_record.duration,
                "value": file_record.value,
                "temporal_from": (
                    file_record.temporal_from.isoformat()
                    if file_record.temporal_from
                    else None
                ),
                "temporal_to": (
                    file_record.temporal_to.isoformat()
                    if file_record.temporal_to
                    else None
                ),
                "geography": file_record.geography,
            }
            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            await self.session.rollback()
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception("Unexpected error editing file: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error editing file",
            )


# Dependency to get upload controller
async def get_upload_controller(
    upload_service: UploadService = Depends(get_upload_service),
    session: AsyncSession = Depends(get_session),
    dataset_service: DatasetService = Depends(get_dataset_service),
    user_service: UserService = Depends(get_user_service),
) -> UploadController:
    """
    Dependency function to get UploadController instance.

    Args:
        upload_service: Upload service dependency
        session: Database session dependency
        dataset_service: Dataset service dependency
        user_service: User service dependency for permission checks

    Returns:
        UploadController instance
    """
    return UploadController(upload_service, session, dataset_service, user_service)


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


@router.post("/add_file")
async def add_files(
    file_title: str = Form(..., description="File title"),
    file_key: str = Form(..., description="S3 file key"),
    file_description: Optional[str] = Form(None, description="File description"),
    file_format: Optional[str] = Form(
        None, description="File format/extension (max 20 chars)"
    ),
    dataset_id: str = Form(..., description="Dataset ID (UUID)"),
    groundtruthed: Optional[bool] = Form(
        None, description="Whether dataset is groundtruthed"
    ),
    provenance: Optional[str] = Form(None, description="Provenance"),
    source: Optional[str] = Form(None, description="Source"),
    cite_as: Optional[str] = Form(None, description="Citation information"),
    permissions: Optional[str] = Form(None, description="Permissions"),
    duration: int = Form(0, description="Duration in years"),
    value: Optional[str] = Form(None, description="Value level (high, medium, low)"),
    temporal_from: Optional[str] = Form(
        None, description="Temporal coverage start date (ISO format)"
    ),
    temporal_to: Optional[str] = Form(
        None, description="Temporal coverage end date (ISO format)"
    ),
    geography: Optional[str] = Form(None, description="Geographic coverage"),
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Add a new file record to the files table.

    This endpoint:
    - Requires authentication (valid session cookie)
    - Checks if the user is active and valid
    - Validates that the dataset exists in the database
    - Validates that the file exists in S3
    - Creates a new file record in the files table

    Args:
        file_title: Title of the file
        file_key: S3 file key (e.g., "user_id/filename")
        file_description: Optional file description
        file_format: Optional file format/extension (max 20 characters)
        dataset_id: Dataset ID (UUID) that this file belongs to
        user: Authenticated user (from dependency)
        controller: Upload controller (from dependency)

    Returns:
        JSON response containing created file information

    Raises:
        HTTPException:
            - 401: Not authenticated
            - 403: User account not active
            - 400: Invalid input data
            - 404: Dataset not found or file does not exist in S3
            - 409: File with this key already exists
            - 500: Internal server error
            - 502: S3 handler service unavailable
            - 504: S3 handler service timeout
    """
    try:
        # Parse dataset_id UUID
        try:
            dataset_uuid = UUID(dataset_id)
        except ValueError:
            logger.warning("Invalid dataset_id UUID format: %s", dataset_id)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid dataset_id UUID format",
            )

        # Parse datetime strings for temporal_from and temporal_to
        parsed_temporal_from = None
        parsed_temporal_to = None
        if temporal_from:
            try:
                parsed_temporal_from = datetime.fromisoformat(
                    temporal_from.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                logger.warning("Invalid temporal_from format: %s", temporal_from)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid temporal_from format. Use ISO format (e.g., 2024-01-01T00:00:00Z)",
                )
        if temporal_to:
            try:
                parsed_temporal_to = datetime.fromisoformat(
                    temporal_to.replace("Z", "+00:00")
                )
            except (ValueError, AttributeError):
                logger.warning("Invalid temporal_to format: %s", temporal_to)
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid temporal_to format. Use ISO format (e.g., 2024-01-01T00:00:00Z)",
                )

        return await controller.add_file(
            file_title=file_title,
            file_key=file_key,
            file_description=file_description,
            file_format=file_format,
            dataset_id=dataset_uuid,
            groundtruthed=groundtruthed,
            provenance=provenance,
            source=source,
            cite_as=cite_as,
            permissions=permissions,
            duration=duration,
            value=value,
            temporal_from=parsed_temporal_from,
            temporal_to=parsed_temporal_to,
            geography=geography,
            user=user,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /add_files: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing add_files request",
        )


@router.delete("/delete_file")
async def delete_file(
    file_id: UUID = Query(..., description="File ID (UUID)"),
    apikey: str = Query(..., description="API key for authentication"),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Delete a file from S3 and the database.

    This endpoint:
    - Takes file_id and apikey as query parameters
    - Checks if the user has permission to delete the file
    - Deletes the file from S3
    - Deletes the file record from the database

    Args:
        file_id: File ID (UUID) to delete
        apikey: API key for authentication
        controller: Upload controller (from dependency)

    Returns:
        JSON response with success or error message

    Raises:
        HTTPException:
            - 403: User does not have permission
            - 404: File does not exist
            - 500: Internal server error
            - 502: S3 handler service unavailable
            - 504: S3 handler service timeout
    """
    return await controller.delete_file(file_id, apikey)


@router.put("/edit_file")
async def edit_file(
    payload: FileEditRequest = Body(..., description="File metadata to update"),
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Update file metadata. Only the dataset creator may edit.

    Request body: file_id, file_title, file_description, provenance, source,
    cite_as, groundtruthed, permissions, duration, value, temporal_from,
    temporal_to, geography. Requires authentication (valid session cookie).
    """
    try:
        return await controller.edit_file(
            file_id=payload.file_id,
            file_title=payload.file_title,
            file_description=payload.file_description,
            provenance=payload.provenance,
            source=payload.source,
            cite_as=payload.cite_as,
            groundtruthed=payload.groundtruthed,
            permissions=payload.permissions,
            duration=payload.duration,
            value=payload.value,
            temporal_from=payload.temporal_from,
            temporal_to=payload.temporal_to,
            geography=payload.geography,
            user=user,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /edit_file: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error editing file",
        )
