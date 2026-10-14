"""
Dataset router for handling dataset creation.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from redis.asyncio import Redis
from redis.exceptions import ResponseError
from core.availability import clamp_availability_for_org, parse_availability
from core.config import settings
from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.dataset import Dataset
from models.file import File
from models.organization import Organization
from models.user import User
from models.user_contribution import UserContribution
from routers.upload import get_current_active_user
from schemas.dataset import EditDatasetRequest
from schemas.user import DatasetOwnerCreate
from utils.security import mask_apikey, optional_api_key
from services.auth import AuthService, RedisStrategy, get_auth_service, get_redis, get_upload_jobs_redis
from services.dataset import DatasetService, get_dataset_service
from services.organization import OrganizationService, get_organization_service
from services.upload import UploadService, get_upload_service
from services.user import UserService, get_user_service
from services.typesense_index import safe_delete_dataset_documents
from sqlalchemy import delete, select, update
from utils.security import sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)


async def _invalidate_dataset_cache(
    dataset_id: UUID, redis: Redis, log: logging.Logger
) -> None:
    """Remove dataset info cache entry if it exists."""
    try:
        cache_key = f"dataset:{dataset_id}"
        if await redis.exists(cache_key):
            await redis.delete(cache_key)
            log.info("Cleared dataset cache key: %s", cache_key)
    except Exception as e:
        log.warning(
            "Failed to clear dataset cache for dataset_id=%s: %s",
            dataset_id,
            e,
        )


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


async def _compute_privileges(
    dataset_id: UUID,
    dataset_organization: str,
    is_approved: bool,
    files_count: int,
    current_user: Optional[User],
    apikey: Optional[str],
    user_service: UserService,
    dataset_service: DatasetService,
) -> Dict[str, bool]:
    """
    Compute privileges for dataset_info response.
    Returns dict with keys: edit, delete_dataset, delete_file, add_file, approval, manage_owners.
    """
    default_privileges = {
        "edit": False,
        "delete_dataset": False,
        "delete_file": False,
        "add_file": False,
        "approval": False,
        "manage_owners": False,
    }
    if current_user is None and not (apikey and apikey.strip()):
        return default_privileges
    user_id: Optional[UUID] = current_user.id if current_user else None
    apikey_val = apikey.strip() if apikey and apikey.strip() else None
    can_edit = False
    can_add = False
    if user_id is not None:
        can_edit = await dataset_service.can_edit_metadata(user_id, dataset_id)
        can_add = await dataset_service.can_edit_or_add_file(user_id, dataset_id)
    elif apikey_val:
        user_data = await user_service.get_user_by_apikey(apikey_val)
        if user_data:
            can_edit = await dataset_service.can_edit_metadata(
                user_data["id"], dataset_id
            )
            can_add = await dataset_service.can_edit_or_add_file(
                user_data["id"], dataset_id
            )
    has_perm = await dataset_service.check_dataset_permission(
        user_id, apikey_val, dataset_id
    )
    has_approval = False
    if not is_approved:
        if user_id is not None:
            belongs_to_org = await user_service.check_user_belongs_to_organization_by_id(
                user_id, dataset_organization
            )
            has_high_role = await user_service.check_if_high_role_by_id(user_id)
            has_approval = belongs_to_org and has_high_role
        elif apikey_val:
            belongs_to_org = await user_service.check_user_belongs_to_organization_by_key(
                apikey_val, dataset_organization
            )
            has_high_role = await user_service.check_if_high_role_by_key(apikey_val)
            has_approval = belongs_to_org and has_high_role

    is_org_admin = False
    if user_id is not None:
        is_org_admin = await user_service.check_if_admin_by_id(
            dataset_organization, user_id
        )
    elif apikey_val:
        is_org_admin = await user_service.check_if_admin_by_key(
            dataset_organization, apikey_val
        )
    manage_owners = False
    if user_id is not None:
        manage_owners = can_add or is_org_admin
        if current_user and current_user.is_superuser:
            manage_owners = True
    elif apikey_val:
        user_data = await user_service.get_user_by_apikey(apikey_val)
        if user_data:
            manage_owners = can_add or is_org_admin or bool(
                user_data.get("is_superuser")
            )

    return {
        "edit": can_edit,
        "add_file": can_add,
        "delete_dataset": has_perm,
        "delete_file": has_perm and files_count > 1,
        "approval": has_approval,
        "manage_owners": manage_owners,
    }


def _job_ttl() -> int:
    return settings.UPLOAD_JOB_CACHE_AGE_SECONDS


# Atomically: append "dataset" to :events, set event:dataset payload, EXPIRE job (no job JSON rewrite).
# Uses Redis Lua + cjson (available in standard Redis Lua environment).
_DATASET_STAGE_LUA = """
local ttl = tonumber(ARGV[1])
local payload = ARGV[2]
local ev_key = KEYS[1]
local job_key = KEYS[2]
local ds_key = KEYS[3]

local ev_raw = redis.call('GET', ev_key)
local ev_list = cjson.decode(ev_raw or '[]')
for i = 1, #ev_list do
  if ev_list[i] == 'dataset' then
    return redis.error_reply('ERR_DUPLICATE_DATASET')
  end
end
table.insert(ev_list, 'dataset')

if redis.call('EXISTS', job_key) == 0 then
  return redis.error_reply('ERR_JOB_MISSING')
end

redis.call('SETEX', ev_key, ttl, cjson.encode(ev_list))
redis.call('SETEX', ds_key, ttl, payload)
redis.call('EXPIRE', job_key, ttl)
return 1
"""


async def _atomic_stage_dataset_event(
    redis_jobs: Redis,
    jid: str,
    ttl: int,
    payload: Dict[str, Any],
) -> None:
    """Single atomic Redis op: events list + job TTL + job:{jid}:event:dataset."""
    payload_json = json.dumps(payload, default=str)
    try:
        await redis_jobs.eval(
            _DATASET_STAGE_LUA,
            3,
            f"job:{jid}:events",
            f"job:{jid}",
            f"job:{jid}:event:dataset",
            str(ttl),
            payload_json,
        )
    except ResponseError as exc:
        err = str(exc)
        if "ERR_DUPLICATE_DATASET" in err:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"dataset information already exist for the job {jid}.",
            ) from exc
        if "ERR_JOB_MISSING" in err:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"job {jid} does not exist.",
            ) from exc
        raise


class DatasetController:
    """
    Class-based dataset controller with comprehensive error handling and security.
    """

    def __init__(
        self,
        dataset_service: DatasetService,
        redis: Redis,
        redis_jobs: Redis,
        user_service: UserService,
        upload_service: UploadService,
    ):
        self.dataset_service = dataset_service
        self.redis = redis
        self.redis_jobs = redis_jobs
        self.user_service = user_service
        self.upload_service = upload_service
        self.logger = logging.getLogger(__name__)

    async def create_dataset(
        self,
        title: str,
        description: Optional[str],
        availability: int,
        tags: List[str],
        job_id: str,
        user: User,
    ) -> JSONResponse:
        """
        Stage dataset creation in Redis (job event); no DB insert.
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

            raw = await self.redis_jobs.get(f"job:{jid}")
            if not raw:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"job {jid} does not exist.",
                )
            job = json.loads(raw)
            if str(job.get("creator")) != str(user.id):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Job does not belong to this user",
                )
            if str(job.get("organization")) != str(user.organization):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Job organization does not match user",
                )

            sanitized_title = sanitize_input(title)
            if not sanitized_title or not sanitized_title.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid title",
                )
            sanitized_desc = sanitize_input(description) if description else None
            norm_tags = self.dataset_service._normalize_tags(tags or [])

            org = await self.dataset_service.get_organization_with_private_status(
                user.organization
            )
            dataset_availability = clamp_availability_for_org(
                parse_availability(availability), org.private
            )

            dataset_id = uuid4()
            approved = False
            approved_by = None
            if await self.user_service.check_if_high_role_by_id(user.id):
                approved = True
                approved_by = user.id

            ttl = _job_ttl()
            now = datetime.now(timezone.utc)
            now_iso = now.isoformat()

            payload = {
                "event_id": "dataset",
                "job_id": jid,
                "type": "create_dataset",
                "status": "pending",
                "error": None,
                "started_at": now_iso,
                "finished_at": None,
                "dataset_id": str(dataset_id),
                "title": sanitized_title,
                "description": sanitized_desc,
                "availability": dataset_availability,
                "tags": norm_tags,
                "creator": str(user.id),
                "organization": user.organization,
                "approved": approved,
                "approved_by": str(approved_by) if approved_by else None,
                "created_at": now_iso,
            }
            await _atomic_stage_dataset_event(self.redis_jobs, jid, ttl, payload)

            return JSONResponse(
                content={"job_id": jid, "dataset_id": str(dataset_id)},
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("create_dataset job error: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error creating dataset",
            )

    async def edit_dataset(
        self,
        dataset_id: UUID,
        dataset_title: str,
        dataset_description: Optional[str],
        availability: int,
        tags: List[str],
    ) -> JSONResponse:
        """
        Update dataset metadata and tags. Caller must have verified creator.

        Returns 404 if dataset not found, 200 with updated dataset JSON otherwise.
        """
        try:
            dataset = await self.dataset_service.update_dataset_metadata_and_tags(
                dataset_id=dataset_id,
                dataset_title=dataset_title,
                dataset_description=dataset_description,
                availability=availability,
                tags=tags or [],
            )
            if dataset is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Dataset not found",
                )

            download_totals = await self.dataset_service.get_download_totals_for_datasets(
                [dataset.dataset_id]
            )
            response_data = {
                "dataset_id": str(dataset.dataset_id),
                "dataset_title": dataset.dataset_title,
                "dataset_description": dataset.dataset_description,
                "availability": dataset.availability,
                "tags": [tag.tag_name for tag in dataset.tags],
                "creator": str(dataset.creator),
                "organization": dataset.organization,
                "downloads": download_totals.get(dataset.dataset_id, 0),
                "approved": dataset.approved,
                "approved_by": str(dataset.approved_by)
                if dataset.approved_by
                else None,
                "created_at": dataset.created_at.isoformat()
                if dataset.created_at
                else None,
            }
            await _invalidate_dataset_cache(dataset_id, self.redis, self.logger)
            return JSONResponse(
                content=jsonable_encoder(response_data),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error editing dataset for dataset_id=%s: %s",
                dataset_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error editing dataset",
            )

    async def add_dataset_owner(
        self,
        user: User,
        dataset_id: UUID,
        target_user_id: UUID,
    ) -> JSONResponse:
        try:
            payload = await self.dataset_service.add_owner(
                actor=user,
                dataset_id=dataset_id,
                target_user_id=target_user_id,
            )
            await _invalidate_dataset_cache(dataset_id, self.redis, self.logger)
            return JSONResponse(
                content=jsonable_encoder(payload),
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error adding owner dataset_id=%s: %s",
                dataset_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error adding dataset owner",
            )

    async def remove_dataset_owner(
        self,
        user: User,
        dataset_id: UUID,
        target_user_id: UUID,
    ) -> JSONResponse:
        try:
            payload = await self.dataset_service.remove_owner(
                actor=user,
                dataset_id=dataset_id,
                target_user_id=target_user_id,
            )
            await _invalidate_dataset_cache(dataset_id, self.redis, self.logger)
            return JSONResponse(
                content=jsonable_encoder(payload),
                status_code=status.HTTP_200_OK,
            )
        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error removing owner dataset_id=%s: %s",
                dataset_id,
                e,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error removing dataset owner",
            )

    async def get_dataset_info(
        self,
        dataset_id: UUID,
        org_service: OrganizationService,
        user_service: UserService,
        current_user: Optional[User],
        apikey: Optional[str],
    ) -> Dict[str, Any]:
        """
        Load dataset and files, build payload (dataset, files, privileges).
        Caller is responsible for caching {dataset, files} in Redis if desired.
        """
        try:
            self.logger.info("Fetching dataset info for %s", dataset_id)

            dataset, files = await self.dataset_service.get_dataset_and_files(
                dataset_id
            )

            creator_result = await self.dataset_service.session.execute(
                select(User).where(User.id == dataset.creator)
            )
            creator_user = creator_result.scalar_one_or_none()
            creator_name = (
                creator_user.full_name if creator_user else None
            )

            approver_name = None
            if dataset.approved_by:
                approver_result = await self.dataset_service.session.execute(
                    select(User).where(User.id == dataset.approved_by)
                )
                approver_user = approver_result.scalar_one_or_none()
                approver_name = approver_user.full_name if approver_user else None

            file_downloads = await self.dataset_service.get_download_counts_for_files(
                [f.file_id for f in files]
            )
            from services.formats import STATUS_AVAILABLE, plan_for_format
            from services.visualization import VisualizationService

            viz = VisualizationService(self.dataset_service.session, self.upload_service)
            converted_status = await viz.statuses_for_files([f.file_id for f in files])
            dataset_downloads = sum(
                file_downloads.get(f.file_id, 0) for f in files
            )

            org = await org_service.get_organization_by_id(dataset.organization)
            organization_name = org.name if org else None

            dataset_obj = {
                "dataset_id": str(dataset.dataset_id),
                "dataset_title": dataset.dataset_title,
                "creator": str(dataset.creator),
                "creator_name": creator_name,
                "created_at": dataset.created_at.isoformat()
                if dataset.created_at
                else None,
                "modified_at": dataset.modified_at.isoformat()
                if dataset.modified_at
                else None,
                "organization": dataset.organization,
                "organization_name": organization_name,
                "availability": dataset.availability,
                "downloads": dataset_downloads,
                "dataset_description": dataset.dataset_description,
                "tags": [tag.tag_name for tag in dataset.tags],
                "approved": dataset.approved,
                "approved_by": str(dataset.approved_by)
                if dataset.approved_by
                else None,
                "approver_name": approver_name,
                "owners": await self.dataset_service.list_owners(dataset_id),
            }

            files_arr = []
            for f in files:
                plan = plan_for_format(f.file_format, f.file_key)
                conv_status = converted_status.get(f.file_id)
                files_arr.append(
                    {
                        "file_id": str(f.file_id),
                        "file_title": f.file_title,
                        "file_name": (
                            f.file_key.rsplit("/", 1)[-1] if f.file_key else None
                        ),
                        "file_size": f.file_size,
                        "file_description": f.file_description,
                        "file_format": f.file_format,
                        "dataset_id": str(f.dataset_id),
                        "downloads": file_downloads.get(f.file_id, 0),
                        "provenance": f.provenance,
                        "source": f.source,
                        "cite_as": f.cite_as,
                        "groundtruthed": f.groundtruthed,
                        "permissions": f.permissions,
                        "duration": f.duration,
                        "temporal_from": f.temporal_from.isoformat()
                        if f.temporal_from
                        else None,
                        "temporal_to": f.temporal_to.isoformat()
                        if f.temporal_to
                        else None,
                        "geography": f.geography,
                        "created_at": f.created_at.isoformat()
                        if f.created_at
                        else None,
                        "modified_at": f.modified_at.isoformat()
                        if getattr(f, "modified_at", None)
                        else None,
                        "viewer": plan.viewer if plan else None,
                        "cloud_native_status": conv_status,
                        "cloud_native_available": bool(
                            (plan and plan.cloud_native)
                            or conv_status == STATUS_AVAILABLE
                        ),
                    }
                )

            privileges = await _compute_privileges(
                dataset_id,
                dataset.organization,
                dataset.approved,
                len(files_arr),
                current_user,
                apikey,
                user_service,
                self.dataset_service,
            )

            return {
                "dataset": dataset_obj,
                "files": files_arr,
                "privileges": privileges,
            }
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
        requesting_user: Optional[User] = None,
        scope: str = "created",
    ) -> JSONResponse:
        """
        Get datasets created or owned by a specific user with pagination and privacy filtering.
        """
        try:
            self.logger.info(
                "Fetching user datasets for user_id=%s, limit=%d, offset=%d, requesting_user=%s, scope=%s",
                user_id,
                limit,
                offset,
                requesting_user.id if requesting_user else None,
                scope,
            )

            datasets, total = await self.dataset_service.get_user_datasets(
                user_id, limit, offset, requesting_user, scope=scope
            )

            for ds in datasets:
                await self.dataset_service.session.refresh(ds, ["tags"])

            datasets_arr = await self.dataset_service.list_item_payloads(datasets)
            counts = None
            if scope in {"published", "pending", "owned"}:
                try:
                    counts = await self.dataset_service.get_user_dataset_counts(
                        user_id, requesting_user
                    )
                except Exception:
                    self.logger.exception("Failed to compute user dataset counts")
                    counts = None

            payload = (
                {"items": datasets_arr, "total": total, "counts": counts}
                if counts is not None
                else datasets_arr
            )
            return JSONResponse(
                content=jsonable_encoder(payload),
                status_code=status.HTTP_200_OK,
                headers={"X-Total-Count": str(total)},
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
        current_user: Optional[User] = None,
        apikey: Optional[str] = None,
        limit: int = 10,
        offset: int = 0,
        topic: Optional[str] = None,
        with_meta: bool = False,
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
            auth_source = "session" if current_user else ("apikey" if apikey else "anonymous")
            self.logger.info(
                "Fetching datasets: auth_source=%s, apikey=%s, limit=%d, offset=%d",
                auth_source,
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            datasets, total = await self.dataset_service.get_datasets(
                current_user=current_user,
                apikey=apikey,
                limit=limit,
                offset=offset,
                topic=topic,
                return_total=True,
            )

            for ds in datasets:
                await self.dataset_service.session.refresh(ds, ["tags"])

            datasets_arr = await self.dataset_service.list_item_payloads(datasets)

            self.logger.info(
                "Successfully fetched %d datasets (auth_source=%s, apikey=%s, limit=%d, offset=%d)",
                len(datasets_arr),
                auth_source,
                "provided" if apikey else "not provided",
                limit,
                offset,
            )

            # Total matching records (before limit/offset) for pagination UIs;
            # the body stays a plain list so existing API consumers are unaffected.
            payload = datasets_arr
            if with_meta:
                total_pages = max(1, -(-total // limit)) if total else 0
                payload = {
                    "items": datasets_arr,
                    "total": total,
                    "limit": limit,
                    "offset": offset,
                    "page": offset // limit + 1,
                    "total_pages": total_pages,
                }
            return JSONResponse(
                content=jsonable_encoder(payload),
                status_code=status.HTTP_200_OK,
                headers={"X-Total-Count": str(total)},
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

    async def delete_dataset(
        self,
        dataset_id: UUID,
        user_id: Optional[UUID] = None,
        apikey: Optional[str] = None,
    ) -> JSONResponse:
        """
        Delete a dataset and all its associated files from S3 and the database.

        This method:
        1. Checks permission using check_dataset_permission
        2. Fetches dataset record to capture creator and organization
        3. Gets all files associated with the dataset
        4. For each file: deletes from S3, then immediately deletes the file record from database
        5. Deletes the dataset record from the database
        6. Verifies deletion was successful (no records with dataset_id remain)
        7. Decrements contributions by 1 for the creator user and organization

        Args:
            dataset_id: UUID of the dataset to delete
            apikey: API key of the user requesting deletion

        Returns:
            JSONResponse with success or error message

        Raises:
            HTTPException: If validation fails or deletion fails
        """
        try:
            self.logger.info(
                "Processing delete_dataset request for dataset_id: %s, apikey: %s",
                dataset_id,
                mask_apikey(apikey),
            )

            has_permission = await self.dataset_service.check_dataset_permission(
                user_id, apikey, dataset_id
            )

            if not has_permission:
                self.logger.warning(
                    "Permission denied for dataset deletion: dataset_id=%s, apikey=%s",
                    dataset_id,
                    mask_apikey(apikey),
                )
                return JSONResponse(
                    content={
                        "detail": "user does not have permission to control this dataset"
                    },
                    status_code=status.HTTP_403_FORBIDDEN,
                )

            # 2. Fetch dataset record to capture creator and organization before deletion
            dataset_result = await self.dataset_service.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            dataset_record = dataset_result.scalar_one_or_none()

            if not dataset_record:
                self.logger.warning("Dataset not found: %s", dataset_id)
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Dataset {dataset_id} does not exist",
                )

            creator_id = dataset_record.creator

            # 3. Get all files for dataset
            files_result = await self.dataset_service.session.execute(
                select(File).where(File.dataset_id == dataset_id)
            )
            files = list(files_result.scalars().all())

            self.logger.info(
                "Found %d files to delete for dataset %s", len(files), dataset_id
            )

            # 5. Delete each file from S3 and database as pairs
            for file_record in files:
                file_key = file_record.file_key
                file_id = file_record.file_id

                try:
                    from services.visualization import VisualizationService

                    viz = VisualizationService(
                        self.dataset_service.session, self.upload_service
                    )
                    await viz.delete_converted_objects(file_id)
                    deleted = await self.upload_service.delete_object(file_key)
                    if not deleted:
                        self.logger.error(
                            "File deletion failed in S3: file_id=%s, file_key=%s",
                            file_id,
                            file_key,
                        )
                        raise HTTPException(
                            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to delete file {file_id} from S3",
                        )

                    self.logger.info(
                        "File deleted from S3: file_id=%s, file_key=%s",
                        file_id,
                        file_key,
                    )

                    # Delete file record from database immediately after S3 deletion
                    await self.dataset_service.session.execute(
                        delete(File).where(File.file_id == file_id)
                    )
                    await self.dataset_service.session.commit()

                    self.logger.info(
                        "File record deleted from database: file_id=%s", file_id
                    )

                except HTTPException:
                    await self.dataset_service.session.rollback()
                    raise

            # 6. Delete dataset record from database (after all files are deleted)
            await self.dataset_service.session.execute(
                delete(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            await self.dataset_service.session.commit()
            await safe_delete_dataset_documents(dataset_id)

            # 7. Verify deletion
            dataset_result = await self.dataset_service.session.execute(
                select(Dataset).where(Dataset.dataset_id == dataset_id)
            )
            remaining_dataset = dataset_result.scalar_one_or_none()

            files_result = await self.dataset_service.session.execute(
                select(File).where(File.dataset_id == dataset_id)
            )
            remaining_files = list(files_result.scalars().all())

            if remaining_dataset is not None or len(remaining_files) > 0:
                self.logger.error(
                    "Deletion verification failed: dataset_id=%s, dataset_exists=%s, files_remaining=%d",
                    dataset_id,
                    remaining_dataset is not None,
                    len(remaining_files),
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Dataset deletion verification failed",
                )

            # 8. Decrement user contributions in user_contributions table (only if row exists and contributions > 0)
            uc_result = await self.dataset_service.session.execute(
                select(UserContribution).where(UserContribution.user_id == creator_id)
            )
            uc = uc_result.scalar_one_or_none()
            if uc is None:
                self.logger.warning(
                    "No user_contribution row for creator_id=%s; skipping decrement",
                    creator_id,
                )
            elif uc.contributions > 0:
                result = await self.dataset_service.session.execute(
                    update(UserContribution)
                    .where(UserContribution.user_id == creator_id)
                    .where(UserContribution.contributions > 0)
                    .values(contributions=UserContribution.contributions - 1)
                )
                if result.rowcount == 0:
                    self.logger.warning(
                        "Decrement matched 0 rows for creator_id=%s", creator_id
                    )
            await self.dataset_service.session.commit()

            await _invalidate_dataset_cache(dataset_id, self.redis, self.logger)
            self.logger.info("Dataset deleted successfully: dataset_id=%s", dataset_id)

            return JSONResponse(
                content={"detail": "dataset deleted successfully"},
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            await self.dataset_service.session.rollback()
            raise
        except Exception as e:
            await self.dataset_service.session.rollback()
            self.logger.exception("Unexpected error deleting dataset: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Error deleting dataset",
            )


# Dependency to get dataset controller
async def get_dataset_controller(
    dataset_service: DatasetService = Depends(get_dataset_service),
    redis: Redis = Depends(get_redis),
    redis_jobs: Redis = Depends(get_upload_jobs_redis),
    user_service: UserService = Depends(get_user_service),
    upload_service: UploadService = Depends(get_upload_service),
) -> DatasetController:
    """
    Dependency function to get DatasetController instance.
    """
    return DatasetController(
        dataset_service, redis, redis_jobs, user_service, upload_service
    )


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
    description: str | None = Form(None, description="Dataset description"),
    availability: int = Form(
        0, description="0 public, 1 private, 2 organization, 3 admins, 4 owners"
    ),
    tags: List[str] = Form(..., description="Tags for the dataset"),
    job_id: str = Form(..., description="Upload job id"),
    user: User = Depends(get_current_active_user),
    controller: DatasetController = Depends(get_dataset_controller),
):
    """
    Stage dataset metadata on the upload job in Redis (no datasets row until complete).
    """
    return await controller.create_dataset(
        title=title,
        description=description,
        availability=availability,
        tags=tags,
        job_id=job_id,
        user=user,
    )


@router.put("/edit_dataset")
async def edit_dataset(
    body: EditDatasetRequest,
    user: User = Depends(get_current_active_user),
    user_service: UserService = Depends(get_user_service),
    controller: DatasetController = Depends(get_dataset_controller),
):
    """
    Update dataset metadata and tags. Only the dataset creator may edit.

    Request body: dataset_id, dataset_title, dataset_description, availability, tags.
    Requires authentication (valid session cookie). Verifies the dataset exists
    (404 if not), then verifies the user is the dataset creator (403 if not).
    """
    try:
        dataset_id = body.dataset_id
        exists = await controller.dataset_service.dataset_exists(dataset_id)
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset not found",
            )
        can_edit = await controller.dataset_service.can_edit_metadata(
            user.id, dataset_id
        )
        if not can_edit:
            logger.warning(
                "Edit dataset denied: user %s cannot edit dataset %s",
                user.id,
                dataset_id,
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to edit this dataset.",
            )
        return await controller.edit_dataset(
            dataset_id=dataset_id,
            dataset_title=body.dataset_title,
            dataset_description=body.dataset_description,
            availability=body.availability,
            tags=body.tags,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /edit_dataset: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error editing dataset",
        )


@router.post("/dataset_owners")
async def add_dataset_owner(
    body: DatasetOwnerCreate,
    user: User = Depends(get_current_active_user),
    controller: DatasetController = Depends(get_dataset_controller),
):
    try:
        return await controller.add_dataset_owner(
            user=user,
            dataset_id=body.dataset_id,
            target_user_id=body.user_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in POST /dataset_owners: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error adding dataset owner",
        )


@router.delete("/dataset_owners")
async def remove_dataset_owner(
    dataset_id: UUID = Query(..., description="Dataset ID"),
    user_id: UUID = Query(..., description="Owner user ID to remove"),
    user: User = Depends(get_current_active_user),
    controller: DatasetController = Depends(get_dataset_controller),
):
    try:
        return await controller.remove_dataset_owner(
            user=user,
            dataset_id=dataset_id,
            target_user_id=user_id,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in DELETE /dataset_owners: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error removing dataset owner",
        )


@router.get("/dataset_info")
async def dataset_info(
    request: Request,
    dataset_id: str = Query(..., description="Dataset ID (UUID)"),
    apikey: Optional[str] = Depends(optional_api_key),
    controller: DatasetController = Depends(get_dataset_controller),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    redis: Redis = Depends(get_redis),
    user_service: UserService = Depends(get_user_service),
    org_service: OrganizationService = Depends(get_organization_service),
):
    """
    Get dataset info and associated files by dataset_id.
    Validates access for private datasets (session cookie or apikey) with
    organization and verified-user checks.
    Returns dataset, files, and privileges. Response may be served from Redis cache.
    """
    try:
        sanitized_ds_id = sanitize_input(dataset_id)
        if not sanitized_ds_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or missing dataset_id",
            )
        sanitized_apikey = sanitize_input(apikey) if apikey else None
        try:
            ds_uuid = UUID(sanitized_ds_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid dataset_id UUID format",
            )

        result = await controller.dataset_service.session.execute(
            select(Dataset).where(Dataset.dataset_id == ds_uuid)
        )
        dataset_row = result.scalar_one_or_none()
        if dataset_row is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Dataset not found",
            )
        dataset_organization = dataset_row.organization
        is_approved = dataset_row.approved

        viewer: Optional[User] = current_user
        if viewer is None and sanitized_apikey:
            viewer = await user_service.get_user_model_by_apikey(sanitized_apikey)

        if not await controller.dataset_service.viewer_can_see(dataset_row, viewer):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={
                    "detail": "Dataset access permission is not granted."
                },
            )

        if dataset_row.availability != 0 and not (
            viewer is not None and viewer.is_superuser
        ):
            is_requesting_user_verified = False
            if viewer is not None:
                is_requesting_user_verified = bool(
                    viewer.verified and viewer.is_verified
                )
            if not is_requesting_user_verified:
                logger.info(
                    "Restricted dataset access denied due to unverified requester: dataset_id=%s",
                    ds_uuid,
                )
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={
                        "detail": "Restricted dataset. Please check if email address verified or organization approved."
                    },
                )

        if not is_approved:
            has_unapproved_dataset_access = False
            if current_user is not None:
                is_creator = await user_service.check_if_dataset_creator_by_id(
                    current_user.id, ds_uuid
                )
                is_owner = await controller.dataset_service.is_dataset_owner(
                    current_user.id, ds_uuid
                )
                belongs_to_dataset_org = (
                    await user_service.check_user_belongs_to_dataset_organization_by_id(
                        current_user.id, ds_uuid
                    )
                )
                has_high_role = await user_service.check_if_high_role_by_id(
                    current_user.id
                )
                has_unapproved_dataset_access = is_creator or is_owner or (
                    belongs_to_dataset_org and has_high_role
                )
            elif sanitized_apikey:
                is_creator = await user_service.check_if_dataset_creator_by_key(
                    sanitized_apikey, ds_uuid
                )
                belongs_to_dataset_org = (
                    await user_service.check_user_belongs_to_dataset_organization_by_key(
                        sanitized_apikey, ds_uuid
                    )
                )
                has_high_role = await user_service.check_if_high_role_by_key(
                    sanitized_apikey
                )
                has_unapproved_dataset_access = is_creator or (
                    belongs_to_dataset_org and has_high_role
                )

            if not has_unapproved_dataset_access:
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Dataset is still pending approval."},
                )

        cache_key = f"dataset:{ds_uuid}"
        cached = await redis.get(cache_key)
        if cached is not None:
            try:
                data = json.loads(cached)
                dataset_obj = data.get("dataset")
                files_arr = data.get("files", [])
                if dataset_obj is not None and files_arr is not None:
                    privileges = await _compute_privileges(
                        ds_uuid,
                        str(dataset_obj.get("organization", "")),
                        bool(dataset_obj.get("approved")),
                        len(files_arr),
                        current_user,
                        sanitized_apikey,
                        user_service,
                        controller.dataset_service,
                    )
                    return JSONResponse(
                        content=jsonable_encoder({
                            "dataset": dataset_obj,
                            "files": files_arr,
                            "privileges": privileges,
                        }),
                        status_code=status.HTTP_200_OK,
                    )
            except (json.JSONDecodeError, TypeError) as e:
                logger.warning("Invalid dataset cache value for %s: %s", ds_uuid, e)

        response_payload = await controller.get_dataset_info(
            ds_uuid,
            org_service,
            user_service,
            current_user,
            sanitized_apikey,
        )
        ttl = settings.DATASET_INFO_CACHE_AGE_SECONDS
        try:
            await redis.setex(
                cache_key,
                ttl,
                json.dumps({
                    "dataset": response_payload["dataset"],
                    "files": response_payload["files"],
                }),
            )
        except Exception as e:
            logger.warning("Failed to cache dataset info for %s: %s", ds_uuid, e)

        return JSONResponse(
            content=jsonable_encoder(response_payload),
            status_code=status.HTTP_200_OK,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /dataset_info: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing dataset info request",
        )


@router.get("/user_datasets")
async def user_datasets(
    user_id: str = Query(..., description="User ID (UUID)"),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    scope: str = Query(
        "created",
        description="created | published | pending | owned",
    ),
    apikey: Optional[str] = Depends(optional_api_key),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    controller: DatasetController = Depends(get_dataset_controller),
    user_service: UserService = Depends(get_user_service),
):
    """
    Get datasets created or owned by a specific user with pagination and privacy filtering.

    `scope=owned` and `scope=pending` are only returned for the logged-in user
    requesting their own dashboard. Other callers only receive approved datasets
    they are allowed to see.
    """
    try:
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user_id UUID format",
            )

        requesting_user = current_user
        sanitized_apikey_raw = sanitize_input(apikey) if apikey else None
        sanitized_apikey = (
            sanitized_apikey_raw.strip()
            if sanitized_apikey_raw and sanitized_apikey_raw.strip()
            else None
        )
        if requesting_user is None and sanitized_apikey:
            user_data = await user_service.get_user_by_apikey(sanitized_apikey)
            if user_data:
                user_result = await controller.dataset_service.session.execute(
                    select(User).where(User.id == user_data["id"])
                )
                requesting_user = user_result.scalar_one_or_none()

        return await controller.get_user_datasets(
            user_uuid, limit, offset, requesting_user, scope=scope
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /user_datasets: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing user datasets request",
        )


@router.get("/user_dataset_counts")
async def user_dataset_counts(
    user_id: str = Query(..., description="User ID (UUID)"),
    apikey: Optional[str] = Depends(optional_api_key),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    controller: DatasetController = Depends(get_dataset_controller),
    user_service: UserService = Depends(get_user_service),
):
    """Tab counts for a user's dashboard. Pending and owned are self-only."""
    try:
        try:
            user_uuid = UUID(user_id)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user_id UUID format",
            )
        requesting_user = current_user
        sanitized_apikey_raw = sanitize_input(apikey) if apikey else None
        sanitized_apikey = (
            sanitized_apikey_raw.strip()
            if sanitized_apikey_raw and sanitized_apikey_raw.strip()
            else None
        )
        if requesting_user is None and sanitized_apikey:
            user_data = await user_service.get_user_by_apikey(sanitized_apikey)
            if user_data:
                user_result = await controller.dataset_service.session.execute(
                    select(User).where(User.id == user_data["id"])
                )
                requesting_user = user_result.scalar_one_or_none()
        counts = await controller.dataset_service.get_user_dataset_counts(
            user_uuid, requesting_user
        )
        return JSONResponse(content=counts, status_code=status.HTTP_200_OK)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /user_dataset_counts: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing user dataset counts",
        )


@router.get("/datasets")
async def datasets(
    apikey: Optional[str] = Depends(optional_api_key),
    limit: int = Query(10, ge=1, le=50, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    topic: Optional[str] = Query(
        None,
        description="Filter to datasets that have at least one tag in this topic",
    ),
    with_meta: bool = Query(
        False,
        description=(
            "When true, return {items, total, limit, offset, page, total_pages} "
            "instead of a plain list"
        ),
    ),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
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
        return await controller.get_datasets(
            current_user=current_user,
            apikey=apikey,
            limit=limit,
            offset=offset,
            topic=topic,
            with_meta=with_meta,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Unexpected error in /datasets: %s", e)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error processing datasets request",
        )


@router.delete("/delete_dataset")
async def delete_dataset(
    dataset_id: UUID = Query(..., description="Dataset ID (UUID)"),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_active_user_optional),
    controller: DatasetController = Depends(get_dataset_controller),
):
    """
    Delete a dataset and all its associated files from S3 and the database.

    This endpoint:
    - Takes dataset_id and apikey as query parameters
    - Checks if the user has permission to delete the dataset
    - Deletes all associated files from S3
    - Deletes all file records and the dataset record from the database
    - Verifies deletion was successful

    Args:
        dataset_id: Dataset ID (UUID) to delete
        apikey: API key for authentication
        controller: Dataset controller (from dependency)

    Returns:
        JSON response with success or error message

    Raises:
        HTTPException:
            - 403: User does not have permission
            - 500: Internal server error (for S3 deletion failures or verification failures)
    """
    if user is None and not apikey:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
        )
    return await controller.delete_dataset(
        dataset_id, user_id=user.id if user else None, apikey=apikey
    )
