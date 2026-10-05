"""
Upload router for handling file upload URL generation.
"""

import asyncio
import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterator, List, Optional
from urllib.parse import quote
from uuid import UUID, uuid4

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
from fastapi.responses import JSONResponse, StreamingResponse
from models.dataset import Dataset
from models.file import File
from models.orphaned_s3_object import OrphanedS3Object
from models.file_download import FileDownloadCount, FileDownloadLog
from models.user import User
from schemas.file import CompleteMultipartRequest, FileEditRequest
from redis.asyncio import Redis
from services.auth import AuthService, RedisStrategy, get_auth_service, get_upload_jobs_redis
from services.dataset import DatasetService, get_dataset_service
from services.upload import (
    S3_PUT_OBJECT_MAX_BYTES,
    UploadService,
    get_upload_service,
)
from services.upload_completion import complete_upload_job
from services.zip_stream import iter_stored_zip
from services.upload_job import get_job_status
from services.typesense_index import (
    safe_delete_file_document,
    safe_index_dataset,
)
from services.user import UserService, get_user_service
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import mask_apikey, optional_api_key, sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)

def _upload_job_ttl() -> int:
    return settings.UPLOAD_JOB_CACHE_AGE_SECONDS


async def _redis_set_json(redis: Redis, key: str, obj: Any, ttl: int) -> None:
    await redis.setex(key, ttl, json.dumps(obj, default=str))


_ZIP32_MAX = 0xFFFFFFFF


def _zip_arcname(file_key: str, file_id: UUID, used: set[str]) -> str:
    raw = (file_key or "").replace("\\", "/").rsplit("/", 1)[-1]
    raw = raw.replace("\x00", "").replace("/", "_").strip()
    if raw in {"", ".", ".."}:
        raw = str(file_id)
    name = raw
    n = 2
    while name in used:
        stem, dot, ext = raw.rpartition(".")
        if dot and stem:
            name = f"{stem} ({n}).{ext}"
        else:
            name = f"{raw} ({n})"
        n += 1
    used.add(name)
    return name


def _zip_download_name(title: Optional[str]) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", (title or "dataset")).strip("-._")
    return f"{(cleaned or 'dataset')[:80]}.zip"


ALLOWED_PERMISSIONS = [
    "CC0: Public Domain",
    "CC BY: Attribution",
    "CC BY-SA: Attribution-ShareAlike",
    "CC BY-NC: Attribution-NonCommercial",
    "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
    "CC BY-ND: Attribution-NoDerivatives",
    "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
]


async def _invalidate_dataset_cache(
    dataset_id: UUID, auth_service: AuthService, log: logging.Logger
) -> None:
    """Remove dataset info cache entry if it exists."""
    try:
        cache_key = f"dataset:{dataset_id}"
        if await auth_service.redis.exists(cache_key):
            await auth_service.redis.delete(cache_key)
            log.info("Cleared dataset cache key: %s", cache_key)
    except Exception as e:
        log.warning(
            "Failed to clear dataset cache for dataset_id=%s: %s",
            dataset_id,
            e,
        )


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

        from utils.security import is_profile_complete

        if not is_profile_complete(user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Complete your profile before continuing",
            )

        return user

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in get_current_active_user: %s", e)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )


async def get_current_user_optional_for_download(
    request: Request,
    apikey: Optional[str] = Depends(optional_api_key),
    auth_service: AuthService = Depends(get_auth_service),
    user_service: UserService = Depends(get_user_service),
) -> Optional[User]:
    """
    Resolve user from session cookie or from X-API-Key. Returns None if neither present or invalid.
    Used by /download_url to allow optional auth for logging and private-dataset checks.
    """
    # 1. Try session cookie
    session_token = request.cookies.get(settings.COOKIE_NAME)
    if session_token:
        try:
            strategy = RedisStrategy(auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS)
            user_id = await strategy.read_token(session_token)
            if user_id:
                user = await auth_service.user_db.get(UUID(user_id))
                if user and user.is_active:
                    return user
        except Exception:
            pass
    # 2. Try X-API-Key header
    if apikey and apikey.strip():
        user = await user_service.get_user_model_by_apikey(apikey.strip())
        if user:
            return user
    return None


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
        auth_service: AuthService,
        redis_jobs: Redis,
    ):
        self.upload_service = upload_service
        self.session = session
        self.dataset_service = dataset_service
        self.user_service = user_service
        self.auth_service = auth_service
        self.redis_jobs = redis_jobs
        self.logger = logging.getLogger(__name__)

    async def create_upload_job(self, user: User) -> JSONResponse:
        """Create Redis job + events; require verified user."""
        if not await self.user_service.check_if_user_verified_by_id(user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="email address verification and/or organization approval pending.",
            )
        ttl = _upload_job_ttl()
        job_id = str(uuid4())
        now = datetime.now(timezone.utc)
        expires_at = datetime.fromtimestamp(now.timestamp() + ttl, tz=timezone.utc)
        job_meta: Dict[str, Any] = {
            "job_id": job_id,
            "creator": str(user.id),
            "full_name": user.full_name,
            "organization": user.organization,
            "status": "open",
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "closed_at": None,
        }
        await _redis_set_json(self.redis_jobs, f"job:{job_id}", job_meta, ttl)
        await self.redis_jobs.setex(f"job:{job_id}:events", ttl, json.dumps([]))
        return JSONResponse(
            content={
                "job_id": job_id,
                "creator": str(user.id),
                "expires_at": expires_at.isoformat(),
            },
            status_code=status.HTTP_200_OK,
        )

    async def get_upload_url(
        self,
        job_id: str,
        filename: str,
        user: User,
        file_size: int,
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
            # Sanitize job_id
            jid = sanitize_input(job_id)
            if not jid or not jid.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid job_id",
                )
            try:
                UUID(jid.strip())
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid job_id",
                )
            jid = jid.strip()

            raw_job = await self.redis_jobs.get(f"job:{jid}")
            if not raw_job:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"job {jid} does not exist.",
                )
            job = json.loads(raw_job)
            if str(job.get("creator")) != str(user.id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Job does not belong to this user",
                )

            sanitized_filename = sanitize_input(filename)
            if not sanitized_filename or not sanitized_filename.strip():
                self.logger.warning(
                    "Invalid filename provided by user %s: %s", user.id, filename
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid filename",
                )

            sanitized_filename = sanitized_filename.split("/")[-1].split("\\")[-1]

            if not sanitized_filename:
                self.logger.warning(
                    "Empty filename after sanitization for user %s", user.id
                )
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid filename",
                )

            self.logger.info(
                "Processing upload URL request for user %s, filename: %s",
                user.id,
                sanitized_filename,
            )

            if file_size < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid file_size",
                )
            max_size = int(settings.S3_UPLOAD_MAX_SIZE)
            if file_size > max_size:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"File exceeds maximum upload size of {max_size} bytes",
                )

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

            file_id = uuid4()
            use_multipart = file_size > S3_PUT_OBJECT_MAX_BYTES
            file_key = f"{user.id}/{sanitized_filename}"
            multipart = None
            url = None
            presigned_data = None

            try:
                if use_multipart:
                    multipart = await self.upload_service.create_multipart_upload(
                        user.id, sanitized_filename, file_size
                    )
                    ttl = _upload_job_ttl()
                    await _redis_set_json(
                        self.redis_jobs,
                        f"multipart:{file_id}",
                        {
                            "job_id": jid,
                            "upload_id": multipart["upload_id"],
                            "key": file_key,
                            "creator": str(user.id),
                        },
                        ttl,
                    )
                else:
                    presigned_data = await self.upload_service.get_presigned_upload_url(
                        user.id, sanitized_filename
                    )
                    url = presigned_data.get("presigned_upload_url")
                    if not url:
                        raise HTTPException(
                            status_code=status.HTTP_502_BAD_GATEWAY,
                            detail="S3 service unavailable",
                        )

                self.session.add(
                    OrphanedS3Object(
                        file_id=file_id,
                        job_id=UUID(jid),
                        file_key=file_key,
                        bucket=settings.S3_BUCKET,
                        status="initiated",
                    )
                )
                await self.session.commit()
            except Exception:
                if multipart:
                    await self.upload_service.abort_multipart_upload(
                        file_key, multipart["upload_id"]
                    )
                raise

            self.logger.info(
                "Presigned URL generated successfully for user %s, filename: %s",
                user.id,
                sanitized_filename,
            )

            if use_multipart:
                return JSONResponse(
                    content={
                        "job_id": jid,
                        "file_id": str(file_id),
                        "multipart": True,
                        "upload_id": multipart["upload_id"],
                        "content_type": multipart["content_type"],
                        "part_size": multipart["part_size"],
                        "part_count": multipart["part_count"],
                        "parts": multipart["parts"],
                    },
                    status_code=status.HTTP_200_OK,
                )

            return JSONResponse(
                content={
                    "job_id": jid,
                    "file_id": str(file_id),
                    "presigned_upload_url": url,
                    "content_type": presigned_data.get("content_type")
                    or "application/octet-stream",
                },
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            await self.session.rollback()
            self.logger.exception(
                "Unexpected error generating upload URL for user %s: %s",
                user.id if user else "unknown",
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating upload URL",
            )

    async def complete_multipart(
        self, body: CompleteMultipartRequest, user: User
    ) -> JSONResponse:
        jid = sanitize_input(body.job_id)
        if not jid or not jid.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid job_id"
            )
        jid = jid.strip()
        raw_job = await self.redis_jobs.get(f"job:{jid}")
        if not raw_job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"job {jid} does not exist.",
            )
        job = json.loads(raw_job)
        if str(job.get("creator")) != str(user.id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Job does not belong to this user",
            )
        raw_mp = await self.redis_jobs.get(f"multipart:{body.file_id}")
        if not raw_mp:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Multipart upload session not found or expired",
            )
        mp = json.loads(raw_mp)
        if mp.get("job_id") != jid or mp.get("upload_id") != body.upload_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Multipart upload does not match this job",
            )
        parts = [{"part_number": p.part_number, "etag": p.etag} for p in body.parts]
        try:
            await self.upload_service.complete_multipart_upload(
                mp["key"], body.upload_id, parts
            )
        except Exception:
            await self.upload_service.abort_multipart_upload(mp["key"], body.upload_id)
            await self.redis_jobs.delete(f"multipart:{body.file_id}")
            raise
        await self.redis_jobs.delete(f"multipart:{body.file_id}")
        return JSONResponse(
            content={"detail": "multipart upload completed", "file_id": str(body.file_id)},
            status_code=status.HTTP_200_OK,
        )

    async def _accessible_file_for_read(
        self,
        file_id: UUID,
        apikey: Optional[str],
        user: Optional[User],
    ) -> tuple[File, Dataset, str]:
        apikey_sanitized = sanitize_input(apikey) if apikey else None
        if apikey and (not apikey_sanitized or not apikey_sanitized.strip()):
            self.logger.warning("Invalid apikey provided for file access")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid apikey",
            )

        result = await self.session.execute(
            select(File, Dataset)
            .join(Dataset, File.dataset_id == Dataset.dataset_id)
            .where(File.file_id == file_id)
        )
        row = result.one_or_none()
        if not row:
            self.logger.warning("File record not found for file_id: %s", file_id)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File record not found",
            )
        file_record, dataset = row

        if not await self.dataset_service.viewer_can_see(dataset, user):
            self.logger.warning(
                "File access denied: availability rules for file_id=%s",
                file_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Download permission is not granted.",
            )

        file_key = file_record.file_key
        file_status = await self.upload_service.check_file_status_by_key(file_key)
        if not file_status.get("exists", False):
            self.logger.warning("File does not exist in S3: %s", file_key)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File does not exist",
            )
        return file_record, dataset, file_key

    async def get_download_url(
        self,
        file_id: UUID,
        apikey: Optional[str],
        user: Optional[User],
    ) -> JSONResponse:
        """Presigned URL that counts as a download."""
        try:
            file_record, _dataset, file_key = await self._accessible_file_for_read(
                file_id, apikey, user
            )
            try:
                stmt = pg_insert(FileDownloadCount).values(
                    file_id=file_id,
                    dataset_id=file_record.dataset_id,
                    downloads=1,
                ).on_conflict_do_update(
                    index_elements=["file_id"],
                    set_={"downloads": FileDownloadCount.downloads + 1},
                )
                await self.session.execute(stmt)
                await self.session.commit()
            except Exception:
                await self.session.rollback()
                self.logger.exception(
                    "Error incrementing FileDownloadCount for file_id %s",
                    file_id,
                )

            if user is not None:
                try:
                    self.session.add(
                        FileDownloadLog(
                            file_id=file_id,
                            user_id=user.id,
                        )
                    )
                    await self.session.commit()
                except Exception as e:
                    await self.session.rollback()
                    self.logger.warning(
                        "Failed to write file_download_log for file_id=%s: %s",
                        file_id,
                        e,
                    )

            presigned_data = await self.upload_service.get_presigned_download_url(
                file_key
            )
            await _invalidate_dataset_cache(
                file_record.dataset_id, self.auth_service, self.logger
            )
            return JSONResponse(
                content=jsonable_encoder(presigned_data),
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error generating download URL for file_id %s: %s",
                file_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error generating download URL",
            )

    async def download_dataset_zip(
        self,
        dataset_id: UUID,
        user: Optional[User],
    ) -> StreamingResponse:
        """Zip every file in the dataset and count a download on each file."""
        dataset, files = await self.dataset_service.get_dataset_and_files(dataset_id)
        if not await self.dataset_service.viewer_can_see(dataset, user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Download permission is not granted.",
            )
        if not files:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="This dataset has no files to download.",
            )

        used_names: set[str] = set()
        members: list[dict[str, Any]] = []
        total_size = 0
        for file_record in files:
            bucket = file_record.bucket or settings.S3_BUCKET
            size = await asyncio.to_thread(
                self.upload_service.object_size, bucket, file_record.file_key
            )
            if size is None:
                self.logger.warning(
                    "Skipping missing S3 object for dataset zip file_id=%s",
                    file_record.file_id,
                )
                continue
            if size > _ZIP32_MAX or total_size + size > _ZIP32_MAX:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="This dataset is too large to download as a single zip.",
                )
            total_size += size
            members.append(
                {
                    "file_id": file_record.file_id,
                    "dataset_id": file_record.dataset_id,
                    "bucket": bucket,
                    "key": file_record.file_key,
                    "arcname": _zip_arcname(
                        file_record.file_key, file_record.file_id, used_names
                    ),
                }
            )

        if not members:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No downloadable files were found for this dataset.",
            )

        try:
            for member in members:
                stmt = pg_insert(FileDownloadCount).values(
                    file_id=member["file_id"],
                    dataset_id=member["dataset_id"],
                    downloads=1,
                ).on_conflict_do_update(
                    index_elements=["file_id"],
                    set_={"downloads": FileDownloadCount.downloads + 1},
                )
                await self.session.execute(stmt)
            if user is not None:
                for member in members:
                    self.session.add(
                        FileDownloadLog(
                            file_id=member["file_id"],
                            user_id=user.id,
                        )
                    )
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            self.logger.exception(
                "Error recording dataset download counts for dataset_id %s",
                dataset_id,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error recording download",
            )

        await _invalidate_dataset_cache(dataset_id, self.auth_service, self.logger)

        upload_service = self.upload_service

        def generate() -> Iterator[bytes]:
            def entries():
                for member in members:
                    yield (
                        member["arcname"],
                        upload_service.iter_object_chunks(member["bucket"], member["key"]),
                    )

            yield from iter_stored_zip(entries())

        filename = _zip_download_name(dataset.dataset_title)
        disposition = (
            f'attachment; filename="{filename}"; '
            f"filename*=UTF-8''{quote(filename)}"
        )
        return StreamingResponse(
            generate(),
            media_type="application/zip",
            headers={
                "Content-Disposition": disposition,
                "Cache-Control": "no-store",
            },
        )

    async def add_file(
        self,
        job_id: str,
        file_id: UUID,
        file_title: str,
        file_description: Optional[str],
        file_format: Optional[str],
        dataset_id: UUID,
        groundtruthed: Optional[bool],
        provenance: Optional[str],
        source: Optional[str],
        cite_as: Optional[str],
        permissions: Optional[str],
        duration: int,
        temporal_from: Optional[datetime],
        temporal_to: Optional[datetime],
        geography: Optional[str],
        user: User,
    ) -> JSONResponse:
        """
        Register an add_file job event in Redis (no files row).
        """
        try:
            jid = sanitize_input(job_id)
            if not jid or not jid.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid job_id",
                )
            jid = jid.strip()
            try:
                UUID(jid)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid job_id",
                )

            raw_job = await self.redis_jobs.get(f"job:{jid}")
            if not raw_job:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"job {jid} does not exist.",
                )
            job = json.loads(raw_job)
            if str(job.get("creator")) != str(user.id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Job does not belong to this user",
                )

            events_raw = await self.redis_jobs.get(f"job:{jid}:events")
            event_ids: List[str] = json.loads(events_raw or "[]")
            has_dataset_in_events = "dataset" in event_ids
            ev_ds = await self.redis_jobs.get(f"job:{jid}:event:dataset")

            if has_dataset_in_events and ev_ds:
                ds_ev = json.loads(ev_ds)
                if str(ds_ev.get("dataset_id")) != str(dataset_id):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=(
                            f"provided Dataset ID {dataset_id} does not match "
                            "with the job details."
                        ),
                    )
            else:
                result_ds = await self.session.execute(
                    select(Dataset).where(Dataset.dataset_id == dataset_id)
                )
                ds_row = result_ds.scalar_one_or_none()
                if not ds_row:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="dataset does not exist or inadequate permission",
                    )
                can_add = await self.dataset_service.can_edit_or_add_file(
                    user.id, dataset_id
                )
                if not can_add:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="dataset does not exist or inadequate permission",
                    )

            sanitized_file_title = sanitize_input(file_title)
            if not sanitized_file_title or not sanitized_file_title.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid file_title",
                )
            sanitized_file_description = (
                sanitize_input(file_description) if file_description else None
            )
            sanitized_file_format = sanitize_input(file_format) if file_format else None
            if sanitized_file_format and len(sanitized_file_format) > 50:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="File format must be 50 characters or less",
                )

            sanitized_provenance = sanitize_input(provenance)
            if sanitized_provenance and len(sanitized_provenance) > 5000:
                self.logger.warning("Provenance truncated (max 5000)")
                sanitized_provenance = sanitized_provenance[:5000]
            sanitized_source = sanitize_input(source)
            if sanitized_source and len(sanitized_source) > 5000:
                self.logger.warning("Source truncated (max 5000)")
                sanitized_source = sanitized_source[:5000]
            sanitized_cite_as = sanitize_input(cite_as)
            sanitized_geography = sanitize_input(geography)
            sanitized_permissions = _validate_permissions(permissions, self.logger)
            duration_value = duration if duration is not None else 0
            if temporal_to is not None and temporal_from is not None:
                if temporal_to < temporal_from:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="temporal_to must be after temporal_from",
                    )

            ttl = _upload_job_ttl()
            lock_key = f"job:{jid}:lock"
            event_id: Optional[str] = None
            for attempt in range(5):
                got = await self.redis_jobs.set(lock_key, "1", nx=True, ex=3)
                if got:
                    try:
                        if not await self.redis_jobs.get(f"job:{jid}"):
                            self.logger.warning(
                                "job:%s missing after lock (expired or deleted)", jid
                            )
                            raise HTTPException(
                                status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"job {jid} does not exist.",
                            )
                        raw_ev = await self.redis_jobs.get(f"job:{jid}:events")
                        reg: List[str] = json.loads(raw_ev or "[]")
                        max_n = 0
                        for e in reg:
                            m = re.match(r"^file_(\d+)$", e)
                            if m:
                                max_n = max(max_n, int(m.group(1)))
                        event_id = f"file_{max_n + 1}"
                        if event_id in reg:
                            raise HTTPException(
                                status_code=status.HTTP_409_CONFLICT,
                                detail=f"event {event_id} already registered",
                            )
                        reg.append(event_id)
                        await self.redis_jobs.setex(
                            f"job:{jid}:events", ttl, json.dumps(reg)
                        )
                        job_ttl_ok = await self.redis_jobs.expire(f"job:{jid}", ttl)
                        if not job_ttl_ok:
                            self.logger.warning(
                                "job:%s missing after lock (expired or deleted)", jid
                            )
                            raise HTTPException(
                                status_code=status.HTTP_404_NOT_FOUND,
                                detail=f"job {jid} does not exist.",
                            )
                    finally:
                        await self.redis_jobs.delete(lock_key)
                    break
                await asyncio.sleep(0.1 * (attempt + 1))
            else:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Could not acquire job lock",
                )

            assert event_id is not None
            now = datetime.now(timezone.utc)
            tf_iso = temporal_from.isoformat() if temporal_from else None
            tt_iso = temporal_to.isoformat() if temporal_to else None
            payload = {
                "event_id": event_id,
                "job_id": jid,
                "type": "add_file",
                "status": "pending",
                "error": None,
                "started_at": now.isoformat(),
                "finished_at": None,
                "file_id": str(file_id),
                "file_title": sanitized_file_title,
                "file_description": sanitized_file_description,
                "file_format": sanitized_file_format,
                "dataset_id": str(dataset_id),
                "groundtruthed": groundtruthed,
                "provenance": sanitized_provenance,
                "source": sanitized_source,
                "cite_as": sanitized_cite_as,
                "permissions": sanitized_permissions,
                "duration": duration_value,
                "temporal_from": tf_iso,
                "temporal_to": tt_iso,
                "geography": sanitized_geography,
                "created_at": now.isoformat(),
            }
            await _redis_set_json(
                self.redis_jobs, f"job:{jid}:event:{event_id}", payload, ttl
            )

            return JSONResponse(
                content={"job_id": jid, "file_id": str(file_id)},
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("add_file error: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error processing add_files request",
            )

    async def delete_file(
        self,
        file_id: UUID,
        user_id: Optional[UUID] = None,
        apikey: Optional[str] = None,
    ) -> JSONResponse:
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
                mask_apikey(apikey),
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

            has_permission = await self.dataset_service.check_dataset_permission(
                user_id, apikey, dataset_id
            )

            if not has_permission:
                self.logger.warning(
                    "Permission denied for file deletion: file_id=%s, apikey=%s",
                    file_id,
                    mask_apikey(apikey),
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

            # 3. Delete converted objects then the native file from S3
            from services.visualization import VisualizationService

            viz = VisualizationService(self.session, self.upload_service)
            await viz.delete_converted_objects(file_id)
            deleted = await self.upload_service.delete_object(file_key)
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

            # 4. Delete from database and mark the dataset as updated
            dataset_row = await self.session.get(Dataset, dataset_id)
            if dataset_row is not None:
                dataset_row.modified_at = datetime.now(timezone.utc)
            await self.session.execute(delete(File).where(File.file_id == file_id))
            await self.session.commit()

            await _invalidate_dataset_cache(dataset_id, self.auth_service, self.logger)
            await safe_delete_file_document(file_id)
            await safe_index_dataset(self.session, dataset_id)
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
            can_edit = await self.dataset_service.can_edit_or_add_file(
                user.id, dataset_id
            )
            if not can_edit:
                self.logger.warning(
                    "Edit denied: user %s is not creator or owner of dataset %s",
                    user.id,
                    dataset_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Only a dataset owner can edit.",
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

            file_record.temporal_from = temporal_from
            file_record.temporal_to = temporal_to
            file_record.geography = sanitize_input(geography)
            now = datetime.now(timezone.utc)
            file_record.modified_at = now
            dataset_row = await self.session.get(Dataset, dataset_id)
            if dataset_row is not None:
                dataset_row.modified_at = now

            self.session.add(file_record)
            await self.session.commit()
            await self.session.refresh(file_record)
            await safe_index_dataset(self.session, dataset_id)

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
            await _invalidate_dataset_cache(dataset_id, self.auth_service, self.logger)
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
    auth_service: AuthService = Depends(get_auth_service),
    redis_jobs: Redis = Depends(get_upload_jobs_redis),
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
    return UploadController(
        upload_service,
        session,
        dataset_service,
        user_service,
        auth_service,
        redis_jobs,
    )


# Route handlers
@router.post("/create_upload_job")
async def http_create_upload_job(
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """Create a new upload job in Redis (UPLOAD_JOBS_BACKEND). Requires verified user."""
    return await controller.create_upload_job(user)


@router.post("/complete_upload_job")
async def http_complete_upload_job(
    job_id: str = Query(..., description="Upload job UUID"),
    user: User = Depends(get_current_active_user),
    session: AsyncSession = Depends(get_session),
    redis_jobs: Redis = Depends(get_upload_jobs_redis),
    upload_service: UploadService = Depends(get_upload_service),
    dataset_service: DatasetService = Depends(get_dataset_service),
    auth_service: AuthService = Depends(get_auth_service),
):
    """Persist datasets/files from Redis job events; requires job status open and matching creator."""
    return await complete_upload_job(
        job_id=job_id,
        user=user,
        session=session,
        redis_jobs=redis_jobs,
        upload_service=upload_service,
        dataset_service=dataset_service,
        auth_service=auth_service,
    )


@router.get("/job_status/{job_id}")
async def http_job_status(
    job_id: str,
    user: User = Depends(get_current_active_user),
    redis_jobs: Redis = Depends(get_upload_jobs_redis),
):
    """Return aggregated job metadata and per-event statuses (creator only)."""
    st = await get_job_status(job_id.strip(), redis_jobs)
    if "error" in st:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=st["error"])
    if str(st.get("creator")) != str(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Job does not belong to this user",
        )
    return st


@router.get("/upload_url")
async def get_upload_url(
    job_id: str = Query(..., description="Upload job UUID"),
    filename: str = Query(..., description="Name of the file to upload"),
    file_size: int = Query(..., description="File size in bytes"),
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """Get a presigned URL (or multipart part URLs) for uploading a file to S3."""
    return await controller.get_upload_url(job_id, filename, user, file_size)


@router.post("/complete_multipart")
async def complete_multipart(
    body: CompleteMultipartRequest,
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """Complete an S3 multipart upload after all parts have been PUT."""
    return await controller.complete_multipart(body, user)


@router.get("/download_url")
async def get_download_url(
    file_id: UUID = Query(..., description="File ID (UUID) for the file to download"),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Get a presigned URL for downloading a file from S3.

    - Requires file_id (required). file_key is resolved from the files table.
    - For private datasets: either session cookie or apikey must be provided, and
      the user's organization must match the dataset's organization.
    - Increments file_download_counts and optionally logs to file_download_logs
      when the user is identified (session or apikey).
    - Returns a presigned download URL if the file exists in S3.

    Raises:
        HTTPException:
            - 400: Invalid file_id or apikey
            - 403: Download permission is not granted (private dataset)
            - 404: File record or S3 object not found
            - 500: Internal server error
    """
    return await controller.get_download_url(file_id, apikey, user)


@router.get("/download_dataset")
async def download_dataset(
    dataset_id: UUID = Query(..., description="Dataset ID whose files should be zipped"),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Download every file in a dataset as one zip.

    Uses the same visibility rules as /download_url. Each file included in the
    zip gets one download count, and a download log row when the user is known.
    """
    return await controller.download_dataset_zip(dataset_id, user)


@router.post("/add_file")
async def add_files(
    job_id: str = Form(..., description="Upload job UUID"),
    file_id: str = Form(..., description="File UUID from presign (/upload_url)"),
    file_title: str = Form(..., description="File title"),
    file_description: Optional[str] = Form(None, description="File description"),
    file_format: Optional[str] = Form(
        None, description="File format/extension (max 50 chars)"
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
    """Stage an add_file event for an upload job (Redis; DB rows are written at /complete_upload_job)."""
    try:
        try:
            file_uuid = UUID(file_id.strip())
        except ValueError:
            logger.warning("Invalid file_id UUID: %s", file_id)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid file_id UUID format",
            )
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
            job_id=job_id,
            file_id=file_uuid,
            file_title=file_title,
            file_description=file_description,
            file_format=file_format,
            dataset_id=dataset_uuid,
            groundtruthed=groundtruthed,
            provenance=provenance,
            source=source,
            cite_as=cite_as,
            permissions=permissions,
            duration=duration,
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
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
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
            - 502: S3 service unavailable
    """
    if user is None and not apikey:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return await controller.delete_file(
        file_id, user_id=user.id if user else None, apikey=apikey
    )


@router.put("/edit_file")
async def edit_file(
    payload: FileEditRequest = Body(..., description="File metadata to update"),
    user: User = Depends(get_current_active_user),
    controller: UploadController = Depends(get_upload_controller),
):
    """
    Update file metadata. Only the dataset creator may edit.

    Request body: file_id, file_title, file_description, provenance, source,
    cite_as, groundtruthed, permissions, duration, temporal_from,
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
