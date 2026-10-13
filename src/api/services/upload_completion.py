"""
Finalize upload jobs: persist datasets/files from Redis event payloads.
"""

import json
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

from core.availability import parse_availability
from core.config import settings
from fastapi import HTTPException, status
from models.dataset import Dataset
from models.file import File
from models.file_download import FileDownloadCount
from models.orphaned_s3_object import OrphanedS3Object
from models.user import User
from models.user_contribution import UserContribution
from redis.asyncio import Redis
from services.auth import AuthService
from services.dataset import DatasetService
from services.upload import UploadService
from services.upload_job import get_job_status
from services.typesense_index import safe_index_dataset
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.email import send_upload_approval
from utils.temporal import parse_coverage_date

logger = logging.getLogger(__name__)

_JOB_META_ALLOWED_KEYS = frozenset(
    {
        "job_id",
        "creator",
        "full_name",
        "organization",
        "status",
        "created_at",
        "expires_at",
        "closed_at",
    }
)


def _normalize_job_meta(job: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only canonical job:{job_id} fields; drop legacy counter/updated_at keys."""
    return {k: job[k] for k in _JOB_META_ALLOWED_KEYS if k in job}


def _ttl() -> int:
    return settings.UPLOAD_JOB_CACHE_AGE_SECONDS


async def _set_json(redis: Redis, key: str, obj: Any, ttl: int) -> None:
    await redis.setex(key, ttl, json.dumps(obj, default=str))


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        logger.warning("Invalid ISO datetime for upload job: %s", s)
        return None


def _parse_coverage(s: Optional[str]):
    if not s:
        return None
    try:
        return parse_coverage_date(s)
    except ValueError:
        logger.warning("Invalid temporal coverage date for upload job: %s", s)
        return None


def _safe_int(val: Any, default: int = 0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(val)
    except (ValueError, TypeError):
        return default


def _truncate_prov_src(
    prov: Optional[str], src: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    p = prov
    s = src
    if p and len(p) > 125:
        p = p[:125]
    if s and len(s) > 1000:
        s = s[:1000]
    return p, s


async def _invalidate_ds_cache(
    dataset_id: UUID, auth_service: AuthService, log: logging.Logger
) -> None:
    try:
        key = f"dataset:{dataset_id}"
        if await auth_service.redis.exists(key):
            await auth_service.redis.delete(key)
            log.info("Cleared dataset cache key: %s", key)
    except Exception as e:
        log.warning("Failed to clear dataset cache: %s", e)


async def complete_upload_job(
    job_id: str,
    user: User,
    session: AsyncSession,
    redis_jobs: Redis,
    upload_service: UploadService,
    dataset_service: DatasetService,
    auth_service: AuthService,
) -> Dict[str, Any]:
    jid = job_id.strip()
    raw_job = await redis_jobs.get(f"job:{jid}")
    if not raw_job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"job {jid} does not exist.",
        )
    job = _normalize_job_meta(json.loads(raw_job))
    if job.get("status") != "open":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"job {jid} is not open",
        )
    if str(job.get("creator")) != str(user.id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Job does not belong to this user",
        )

    ttl = _ttl()
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    job["status"] = "in_progress"
    await _set_json(redis_jobs, f"job:{jid}", job, ttl)

    or_result = await session.execute(
        select(OrphanedS3Object).where(OrphanedS3Object.job_id == UUID(jid))
    )
    orphans: List[OrphanedS3Object] = list(or_result.scalars().all())
    file_sizes: Dict[UUID, int] = {}
    for row in orphans:
        st = await upload_service.check_file_status_by_key(row.file_key)
        if not st.get("exists", False):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"file {row.file_key} has not been uploaded.",
            )
        sz = st.get("size") or 0
        file_sizes[row.file_id] = int(sz) if sz is not None else 0
        row.status = "orphaned"
        session.add(row)
    await session.commit()

    events_raw = await redis_jobs.get(f"job:{jid}:events")
    event_ids: List[str] = json.loads(events_raw or "[]")
    dataset_ids_to_invalidate: set[UUID] = set()
    any_failed_event = False

    for eid in event_ids:
        if eid == "dataset":
            ev_raw = await redis_jobs.get(f"job:{jid}:event:dataset")
            if not ev_raw:
                continue
            ev = json.loads(ev_raw)
            try:
                ev["status"] = "in_progress"
                await _set_json(
                    redis_jobs, f"job:{jid}:event:dataset", ev, ttl
                )
                ds_id = UUID(str(ev["dataset_id"]))
                appr = bool(ev.get("approved", False))
                appr_by = (
                    UUID(str(ev["approved_by"])) if ev.get("approved_by") else None
                )
                created_at = _parse_iso(ev.get("created_at")) or now
                ds = Dataset(
                    dataset_id=ds_id,
                    dataset_title=str(ev["title"]),
                    creator=UUID(str(ev["creator"])),
                    dataset_description=ev.get("description"),
                    organization=str(ev["organization"]),
                    availability=parse_availability(
                        ev.get("availability", ev.get("private", 0))
                    ),
                    approved=appr,
                    approved_by=appr_by,
                    created_at=created_at,
                )
                session.add(ds)
                await session.flush()
                await dataset_service.seed_creator_as_owner(
                    ds_id, UUID(str(ev["creator"])), added_by=UUID(str(ev["creator"]))
                )
                tags_list = ev.get("tags") or []
                if isinstance(tags_list, str):
                    tags_list = [tags_list]
                await dataset_service.attach_tags_to_dataset(ds_id, tags_list)
                creator_uid = UUID(str(ev["creator"]))
                org_id = str(ev["organization"])
                uc_stmt = pg_insert(UserContribution).values(
                    id=uuid4(),
                    user_id=creator_uid,
                    organization_id=org_id,
                    contributions=1,
                ).on_conflict_do_update(
                    index_elements=[UserContribution.user_id],
                    set_={
                        "contributions": UserContribution.contributions + 1,
                    },
                )
                await session.execute(uc_stmt)
                ev["status"] = "completed"
                ev["finished_at"] = datetime.now(timezone.utc).isoformat()
                ev["error"] = None
                await _set_json(
                    redis_jobs, f"job:{jid}:event:dataset", ev, ttl
                )
                await session.commit()
                dataset_ids_to_invalidate.add(ds_id)
                if not appr:
                    q = await session.execute(
                        select(User).where(
                            User.organization == org_id,
                            User.role > 0,
                        )
                    )
                    approvers = list(q.scalars().all())
                    title_t = str(ev["title"])
                    name_t = str(job.get("full_name", ""))
                    for u in approvers:
                        if u.email:
                            send_upload_approval.apply_async(
                                args=[u.email, title_t, name_t]
                            )
            except HTTPException:
                await session.rollback()
                raise
            except Exception as ex:
                any_failed_event = True
                logger.exception("dataset event failed: %s", ex)
                await session.rollback()
                try:
                    ev = json.loads(
                        await redis_jobs.get(f"job:{jid}:event:dataset") or "{}"
                    )
                    ev["status"] = "failed"
                    ev["error"] = str(ex)
                    ev["finished_at"] = datetime.now(timezone.utc).isoformat()
                    await _set_json(
                        redis_jobs,
                        f"job:{jid}:event:dataset",
                        ev,
                        ttl,
                    )
                except Exception:
                    ds_event_key = f"job:{jid}:event:dataset"
                    logger.exception(
                        "Failed to persist failed-event status to Redis after dataset "
                        "handler error: job_id=%s event_key=%s",
                        jid,
                        ds_event_key,
                    )
            continue

        m = re.match(r"^file_(\d+)$", eid)
        if not m:
            continue
        ev_raw = await redis_jobs.get(f"job:{jid}:event:{eid}")
        if not ev_raw:
            continue
        ev = json.loads(ev_raw)
        try:
            ev["status"] = "in_progress"
            await _set_json(redis_jobs, f"job:{jid}:event:{eid}", ev, ttl)
            fid = UUID(str(ev["file_id"]))
            ds_uuid = UUID(str(ev["dataset_id"]))
            o_row = await session.execute(
                select(OrphanedS3Object).where(OrphanedS3Object.file_id == fid)
            )
            orphan = o_row.scalar_one_or_none()
            if not orphan:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"orphaned_s3_objects row missing for file_id={fid}",
                )
            prov, src = _truncate_prov_src(ev.get("provenance"), ev.get("source"))
            tf = _parse_coverage(ev.get("temporal_from"))
            tt = _parse_coverage(ev.get("temporal_to"))
            nf = File(
                file_id=fid,
                file_title=str(ev["file_title"]),
                file_key=orphan.file_key,
                file_description=ev.get("file_description"),
                file_format=ev.get("file_format"),
                dataset_id=ds_uuid,
                file_size=file_sizes.get(fid, 0),
                bucket=orphan.bucket or settings.S3_BUCKET,
                created_at=_parse_iso(ev.get("created_at")) or now,
                provenance=prov,
                source=src,
                cite_as=ev.get("cite_as"),
                groundtruthed=ev.get("groundtruthed"),
                permissions=ev.get("permissions") or "CC0: Public Domain",
                duration=_safe_int(ev.get("duration"), 0),
                temporal_from=tf,
                temporal_to=tt,
                geography=ev.get("geography"),
            )
            session.add(nf)
            session.add(
                FileDownloadCount(
                    file_id=fid,
                    dataset_id=ds_uuid,
                    downloads=0,
                )
            )
            parent = await session.get(Dataset, ds_uuid)
            if parent is not None:
                parent.modified_at = datetime.now(timezone.utc)
            orphan.status = "completed"
            session.add(orphan)
            ev["status"] = "completed"
            ev["finished_at"] = datetime.now(timezone.utc).isoformat()
            ev["error"] = None
            await _set_json(redis_jobs, f"job:{jid}:event:{eid}", ev, ttl)
            await session.commit()
            dataset_ids_to_invalidate.add(ds_uuid)
        except HTTPException:
            await session.rollback()
            raise
        except Exception as ex:
            any_failed_event = True
            logger.exception("file event failed: %s", ex)
            await session.rollback()
            try:
                ev = json.loads(
                    await redis_jobs.get(f"job:{jid}:event:{eid}") or "{}"
                )
                ev["status"] = "failed"
                ev["error"] = str(ex)
                ev["finished_at"] = datetime.now(timezone.utc).isoformat()
                await _set_json(
                    redis_jobs, f"job:{jid}:event:{eid}", ev, ttl
                )
            except Exception:
                file_event_key = f"job:{jid}:event:{eid}"
                logger.exception(
                    "Failed to persist failed-event status to Redis after file "
                    "handler error: job_id=%s event_key=%s",
                    jid,
                    file_event_key,
                )

    raw_final = await redis_jobs.get(f"job:{jid}")
    if raw_final:
        jfinal = _normalize_job_meta(json.loads(raw_final))
        jfinal["status"] = (
            "completed_with_errors" if any_failed_event else "completed"
        )
        jfinal["closed_at"] = datetime.now(timezone.utc).isoformat()
        await _set_json(redis_jobs, f"job:{jid}", jfinal, ttl)

    for did in dataset_ids_to_invalidate:
        await _invalidate_ds_cache(did, auth_service, logger)
        await safe_index_dataset(session, did)

    return await get_job_status(jid, redis_jobs)
