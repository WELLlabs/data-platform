"""
Upload service for handling S3 presigned URL generation and file status checks.
"""

import logging
import mimetypes
from typing import Any, Dict
from urllib.parse import quote
from uuid import UUID

import httpx
from core.config import settings
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)


class UploadService:
    """
    Service class for upload operations with S3 handler API interactions.

    This service handles communication with the S3 handler service to:
    - Check file existence status
    - Generate presigned upload URLs
    """

    def __init__(self):
        self.s3_handler_url = settings.S3_HANDLER_URL.rstrip("/")
        self.s3_region = settings.S3_REGION
        self.s3_bucket = settings.S3_BUCKET
        self.logger = logging.getLogger(__name__)

    def _get_content_type(self, filename: str) -> str:
        """
        Get content type (MIME type) from filename.

        Args:
            filename: Name of the file with extension

        Returns:
            Content type string (default: application/octet-stream)
        """
        content_type, _ = mimetypes.guess_type(filename)
        if not content_type:
            content_type = "application/octet-stream"
        return content_type

    async def check_file_exists(self, user_id: UUID, filename: str) -> Dict[str, Any]:
        """
        Check if a file already exists in S3.

        Args:
            user_id: UUID of the user
            filename: Name of the file

        Returns:
            Dictionary containing file status information

        Raises:
            HTTPException: If the S3 handler API request fails
        """
        try:
            self.logger.info(
                "Checking file existence for user %s, filename: %s", user_id, filename
            )

            # Construct the file key
            file_key = f"{user_id}/{filename}"

            # Prepare query parameters
            params = {
                "key": file_key,
                "s3_region": self.s3_region,
                "s3_bucket": self.s3_bucket,
            }

            # Make request to S3 handler status endpoint
            async with httpx.AsyncClient(timeout=10.0) as client:
                self.logger.info(
                    f"Making request to S3 handler status endpoint: {self.s3_handler_url}/status"
                )
                response = await client.get(
                    f"{self.s3_handler_url}/status",
                    params=params,
                )

                if response.status_code != 200:
                    self.logger.error(
                        "S3 handler status endpoint returned status %d: %s",
                        response.status_code,
                        response.text,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="S3 handler service unavailable",
                    )

                data = response.json()
                self.logger.info(
                    "File status check result for %s: exists=%s",
                    file_key,
                    data.get("exists", False),
                )

                return data

        except httpx.TimeoutException:
            self.logger.exception("Timeout while checking file status")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="S3 handler service timeout",
            )
        except httpx.RequestError as e:
            self.logger.exception("Request error while checking file status: %s", e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="S3 handler service connection error",
            )
        except Exception as e:
            self.logger.exception("Unexpected error checking file status: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error checking file status",
            )

    async def get_presigned_upload_url(
        self, user_id: UUID, filename: str
    ) -> Dict[str, Any]:
        """
        Get a presigned URL for uploading a file to S3.

        Args:
            user_id: UUID of the user
            filename: Name of the file with extension

        Returns:
            Dictionary containing presigned URL information

        Raises:
            HTTPException: If the S3 handler API request fails
        """
        try:
            self.logger.info(
                "Requesting presigned upload URL for user %s, filename: %s",
                user_id,
                filename,
            )

            # Construct the file key
            file_key = f"{user_id}/{filename}"

            # Get content type from filename
            content_type = self._get_content_type(filename)

            # Prepare query parameters
            params = {
                "key": file_key,
                "s3_region": self.s3_region,
                "s3_bucket": self.s3_bucket,
                "content_type": content_type,
            }

            # Make request to S3 handler presigned upload endpoint (POST with query params)
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    f"{self.s3_handler_url}/presigned/upload",
                    params=params,
                )

                if response.status_code != 200:
                    self.logger.error(
                        "S3 handler presigned upload endpoint returned status %d: %s",
                        response.status_code,
                        response.text,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="S3 handler service unavailable",
                    )

                data = response.json()
                self.logger.info(
                    "Presigned URL generated successfully for %s", file_key
                )

                # Include the content_type used to generate the presigned URL
                # This ensures the frontend uses the exact same content type when uploading
                data["content_type"] = content_type

                return data

        except httpx.TimeoutException:
            self.logger.exception("Timeout while getting presigned URL")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="S3 handler service timeout",
            )
        except httpx.RequestError as e:
            self.logger.exception("Request error while getting presigned URL: %s", e)
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="S3 handler service connection error",
            )
        except Exception as e:
            self.logger.exception("Unexpected error getting presigned URL: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating presigned URL",
            )

    async def check_file_status_by_key(self, file_key: str) -> Dict[str, Any]:
        """
        Check if a file exists in S3 by file key.

        This method is used when we already have the file_key
        (e.g., from form input) and need to verify the file exists
        and get its metadata.

        Args:
            file_key: S3 file key (e.g., "user_id/filename")

        Returns:
            Dictionary containing file status information with keys:
            - key: The file key
            - exists: Boolean indicating if file exists
            - size: File size in bytes (if exists)
            - last_modified: ISO timestamp (if exists)
            - etag: File etag (if exists)

        Raises:
            HTTPException: If the S3 handler API request fails
        """
        try:
            self.logger.info("Checking file status by key: %s", file_key)

            # Prepare query parameters
            params = {
                "key": file_key,
                "s3_region": self.s3_region,
                "s3_bucket": self.s3_bucket,
            }

            # Make request to S3 handler status endpoint
            async with httpx.AsyncClient(timeout=10.0) as client:
                self.logger.info(
                    f"Making request to S3 handler status endpoint: {self.s3_handler_url}/status"
                )
                response = await client.get(
                    f"{self.s3_handler_url}/status",
                    params=params,
                )

                if response.status_code != 200:
                    self.logger.error(
                        "S3 handler status endpoint returned status %d: %s",
                        response.status_code,
                        response.text,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="S3 handler service unavailable",
                    )

                data = response.json()
                self.logger.info(
                    "File status check result for key %s: exists=%s, size=%s",
                    file_key,
                    data.get("exists", False),
                    data.get("size", 0),
                )

                return data

        except httpx.TimeoutException:
            self.logger.exception("Timeout while checking file status by key")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="S3 handler service timeout",
            )
        except httpx.RequestError as e:
            self.logger.exception(
                "Request error while checking file status by key: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="S3 handler service connection error",
            )
        except Exception as e:
            self.logger.exception("Unexpected error checking file status by key: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error checking file status",
            )

    async def get_presigned_download_url(self, file_key: str) -> Dict[str, Any]:
        """
        Get a presigned URL for downloading a file from S3.

        Args:
            file_key: S3 file key (e.g., "user_id/filename")

        Returns:
            Dictionary containing presigned download URL information

        Raises:
            HTTPException: If the S3 handler API request fails
        """
        try:
            self.logger.info(
                "Requesting presigned download URL for file_key: %s", file_key
            )

            # Prepare query parameters
            params = {
                "s3_region": self.s3_region,
                "s3_bucket": self.s3_bucket,
            }

            # Make request to S3 handler presigned download endpoint
            # file_key is used as path parameter - encode special chars but preserve slashes
            encoded_file_key = quote(file_key, safe="/")
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.s3_handler_url}/presigned/download/{encoded_file_key}",
                    params=params,
                )

                if response.status_code != 200:
                    self.logger.error(
                        "S3 handler presigned download endpoint returned status %d: %s",
                        response.status_code,
                        response.text,
                    )
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="S3 handler service unavailable",
                    )

                data = response.json()
                self.logger.info(
                    "Presigned download URL generated successfully for %s", file_key
                )

                return data

        except httpx.TimeoutException:
            self.logger.exception("Timeout while getting presigned download URL")
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="S3 handler service timeout",
            )
        except httpx.RequestError as e:
            self.logger.exception(
                "Request error while getting presigned download URL: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="S3 handler service connection error",
            )
        except Exception as e:
            self.logger.exception(
                "Unexpected error getting presigned download URL: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating presigned download URL",
            )


def get_upload_service() -> UploadService:
    """
    Dependency function to get UploadService instance.

    Returns:
        UploadService instance
    """
    return UploadService()
