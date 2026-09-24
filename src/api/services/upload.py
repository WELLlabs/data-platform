"""
Upload service: S3 status, delete, and presigned upload/download (including multipart).
"""

import asyncio
import logging
import math
import mimetypes
from typing import Any, Dict, List, Optional
from uuid import UUID

import boto3
from botocore.config import Config as BotoConfig
from botocore.exceptions import BotoCoreError, ClientError
from core.config import settings
from fastapi import HTTPException, status

logger = logging.getLogger(__name__)

S3_PUT_OBJECT_MAX_BYTES = 5 * 1024 * 1024 * 1024  # 5 GiB
MIN_MULTIPART_PART_BYTES = 16 * 1024 * 1024  # 16 MiB
MAX_MULTIPART_PARTS = 10_000

_s3_client = None


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        kwargs: Dict[str, Any] = {
            "region_name": settings.S3_REGION,
            "config": BotoConfig(signature_version="s3v4"),
        }
        key = settings.AWS_ACCESS_KEY_ID.strip()
        secret = settings.AWS_SECRET_ACCESS_KEY.strip()
        if key and secret:
            kwargs["aws_access_key_id"] = key
            kwargs["aws_secret_access_key"] = secret
        _s3_client = boto3.client("s3", **kwargs)
    return _s3_client


class UploadService:
    def __init__(self):
        self.s3_region = settings.S3_REGION
        self.s3_bucket = settings.S3_BUCKET
        self.logger = logging.getLogger(__name__)

    def _get_content_type(self, filename: str) -> str:
        content_type, _ = mimetypes.guess_type(filename)
        return content_type or "application/octet-stream"

    def _upload_expires_seconds(self) -> int:
        return max(60, int(settings.S3_UPLOAD_EXP_TIME_MINS) * 60)

    def _download_expires_seconds(self) -> int:
        return max(60, int(settings.S3_DOWNLOAD_EXP_TIME_MINS) * 60)

    def _raise_s3_error(self, action: str, exc: Exception) -> None:
        self.logger.exception("S3 %s failed: %s", action, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="S3 service unavailable",
        )

    def _head_object_sync(self, file_key: str) -> Dict[str, Any]:
        client = get_s3_client()
        try:
            resp = client.head_object(Bucket=self.s3_bucket, Key=file_key)
            return {
                "key": file_key,
                "exists": True,
                "size": resp.get("ContentLength", 0),
                "last_modified": (
                    resp["LastModified"].isoformat()
                    if resp.get("LastModified")
                    else None
                ),
                "etag": (resp.get("ETag") or "").strip('"'),
            }
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return {
                    "key": file_key,
                    "exists": False,
                    "size": 0,
                    "last_modified": None,
                    "etag": None,
                }
            self._raise_s3_error("head_object", e)
        except BotoCoreError as e:
            self._raise_s3_error("head_object", e)

    def _delete_object_sync(self, file_key: str) -> bool:
        client = get_s3_client()
        try:
            client.delete_object(Bucket=self.s3_bucket, Key=file_key)
            return True
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("404", "NoSuchKey", "NotFound"):
                return False
            self._raise_s3_error("delete_object", e)
        except BotoCoreError as e:
            self._raise_s3_error("delete_object", e)

    def _presign_put_sync(self, file_key: str, content_type: str) -> str:
        client = get_s3_client()
        try:
            return client.generate_presigned_url(
                "put_object",
                Params={
                    "Bucket": self.s3_bucket,
                    "Key": file_key,
                    "ContentType": content_type,
                },
                ExpiresIn=self._upload_expires_seconds(),
                HttpMethod="PUT",
            )
        except (ClientError, BotoCoreError) as e:
            self._raise_s3_error("presign_put", e)

    def _presign_get_sync(
        self,
        file_key: str,
        inline: bool = False,
        content_type: Optional[str] = None,
    ) -> str:
        client = get_s3_client()
        filename = file_key.rsplit("/", 1)[-1]
        disposition = "inline" if inline else "attachment"
        params: Dict[str, Any] = {
            "Bucket": self.s3_bucket,
            "Key": file_key,
            "ResponseContentDisposition": f'{disposition}; filename="{filename}"',
        }
        if inline and content_type:
            params["ResponseContentType"] = content_type
        try:
            return client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=self._download_expires_seconds(),
                HttpMethod="GET",
            )
        except (ClientError, BotoCoreError) as e:
            self._raise_s3_error("presign_get", e)

    def _create_multipart_sync(
        self, file_key: str, content_type: str
    ) -> str:
        client = get_s3_client()
        try:
            resp = client.create_multipart_upload(
                Bucket=self.s3_bucket,
                Key=file_key,
                ContentType=content_type,
            )
            return resp["UploadId"]
        except (ClientError, BotoCoreError) as e:
            self._raise_s3_error("create_multipart_upload", e)

    def _presign_upload_part_sync(
        self, file_key: str, upload_id: str, part_number: int
    ) -> str:
        client = get_s3_client()
        try:
            return client.generate_presigned_url(
                "upload_part",
                Params={
                    "Bucket": self.s3_bucket,
                    "Key": file_key,
                    "UploadId": upload_id,
                    "PartNumber": part_number,
                },
                ExpiresIn=self._upload_expires_seconds(),
                HttpMethod="PUT",
            )
        except (ClientError, BotoCoreError) as e:
            self._raise_s3_error("presign_upload_part", e)

    def _complete_multipart_sync(
        self, file_key: str, upload_id: str, parts: List[Dict[str, Any]]
    ) -> None:
        client = get_s3_client()
        boto_parts = [
            {"ETag": p["etag"], "PartNumber": int(p["part_number"])}
            for p in sorted(parts, key=lambda x: int(x["part_number"]))
        ]
        try:
            client.complete_multipart_upload(
                Bucket=self.s3_bucket,
                Key=file_key,
                UploadId=upload_id,
                MultipartUpload={"Parts": boto_parts},
            )
        except (ClientError, BotoCoreError) as e:
            self._raise_s3_error("complete_multipart_upload", e)

    def _abort_multipart_sync(self, file_key: str, upload_id: str) -> None:
        client = get_s3_client()
        try:
            client.abort_multipart_upload(
                Bucket=self.s3_bucket, Key=file_key, UploadId=upload_id
            )
        except ClientError:
            self.logger.warning(
                "abort_multipart_upload ignored for key=%s upload_id=%s",
                file_key,
                upload_id,
            )

    @staticmethod
    def part_size_for(file_size: int) -> int:
        if file_size <= 0:
            return MIN_MULTIPART_PART_BYTES
        needed = math.ceil(file_size / MAX_MULTIPART_PARTS)
        return max(MIN_MULTIPART_PART_BYTES, needed)

    async def check_file_exists(self, user_id: UUID, filename: str) -> Dict[str, Any]:
        file_key = f"{user_id}/{filename}"
        return await self.check_file_status_by_key(file_key)

    async def check_file_status_by_key(self, file_key: str) -> Dict[str, Any]:
        try:
            self.logger.info("Checking file status by key: %s", file_key)
            data = await asyncio.to_thread(self._head_object_sync, file_key)
            self.logger.info(
                "File status check result for key %s: exists=%s, size=%s",
                file_key,
                data.get("exists", False),
                data.get("size", 0),
            )
            return data
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error checking file status: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error checking file status",
            )

    async def get_presigned_upload_url(
        self, user_id: UUID, filename: str
    ) -> Dict[str, Any]:
        file_key = f"{user_id}/{filename}"
        content_type = self._get_content_type(filename)
        try:
            url = await asyncio.to_thread(
                self._presign_put_sync, file_key, content_type
            )
            return {
                "presigned_upload_url": url,
                "content_type": content_type,
                "key": file_key,
            }
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error getting presigned URL: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating presigned URL",
            )

    async def create_multipart_upload(
        self, user_id: UUID, filename: str, file_size: int
    ) -> Dict[str, Any]:
        file_key = f"{user_id}/{filename}"
        content_type = self._get_content_type(filename)
        part_size = self.part_size_for(file_size)
        part_count = max(1, math.ceil(file_size / part_size))
        if part_count > MAX_MULTIPART_PARTS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File is too large to upload in parts",
            )
        try:
            upload_id = await asyncio.to_thread(
                self._create_multipart_sync, file_key, content_type
            )
            parts = []
            for n in range(1, part_count + 1):
                url = await asyncio.to_thread(
                    self._presign_upload_part_sync, file_key, upload_id, n
                )
                parts.append({"part_number": n, "url": url})
            return {
                "multipart": True,
                "upload_id": upload_id,
                "key": file_key,
                "content_type": content_type,
                "part_size": part_size,
                "part_count": part_count,
                "parts": parts,
            }
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error creating multipart upload: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating multipart upload URLs",
            )

    async def complete_multipart_upload(
        self, file_key: str, upload_id: str, parts: List[Dict[str, Any]]
    ) -> None:
        await asyncio.to_thread(
            self._complete_multipart_sync, file_key, upload_id, parts
        )

    async def abort_multipart_upload(self, file_key: str, upload_id: str) -> None:
        await asyncio.to_thread(self._abort_multipart_sync, file_key, upload_id)

    async def delete_object(self, file_key: str) -> bool:
        try:
            return await asyncio.to_thread(self._delete_object_sync, file_key)
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error deleting S3 object: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error deleting file from S3",
            )

    async def get_presigned_download_url(
        self,
        file_key: str,
        inline: bool = False,
        content_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            url = await asyncio.to_thread(
                self._presign_get_sync, file_key, inline, content_type
            )
            return {
                "download_url": url,
                "presigned_download_url": url,
                "key": file_key,
                "expires_in": self._download_expires_seconds(),
            }
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error getting presigned download URL: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating presigned download URL",
            )


def get_upload_service() -> UploadService:
    return UploadService()
