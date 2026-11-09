"""CPU-bound visualization conversion, isolated from the API and email workers."""

from __future__ import annotations

import logging
import tempfile
from pathlib import Path
from uuid import UUID

from celery.exceptions import SoftTimeLimitExceeded
from core.celery import celery_app
from core.config import settings
from services.upload import get_s3_client

logger = logging.getLogger(__name__)


def _download(bucket: str, key: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    get_s3_client().download_file(bucket, key, str(dest))


def _upload(bucket: str, key: str, src: Path, content_type: str) -> None:
    extra = {"ContentType": content_type}
    get_s3_client().upload_file(str(src), bucket, key, ExtraArgs=extra)


def _convert_raster(session, row, native, bucket: str) -> dict:
    """Serve a GeoTIFF as uploaded when it is already sound, else write a fixed COG.

    1. Read only the header with ``gdalinfo`` over a presigned URL. The
       file is downloaded only when a derivative has to be written.
    2. Decide (``raster_inspect.plan_raster``): a real COG (checked with
       rio-cogeo's ``cog_validate``) with sound georeferencing is reused as
       is, with no conversion. A missing or
       mislabelled CRS, or GCP-only georeferencing, gets a fixed derivative.
       A file that cannot be placed is reused and the preview explains why.
    3. Check the derivative with ``gdalinfo`` before publishing it.
    """
    from datetime import datetime, timezone

    from services.cog_check import is_s3_object_cog, rio_cog_validate
    from services.conversion import ConversionError, _run, convert_cog
    from services.formats import STATUS_AVAILABLE, mime_for_cloud_format
    from services.raster_georef import GEOREF_UNPLACEABLE, parse_candidates, parse_region
    from services.raster_inspect import gdalinfo_json, plan_raster, verify_output

    candidates = parse_candidates(settings.RASTER_CRS_CANDIDATES)
    region = parse_region(settings.RASTER_EXPECTED_REGION)
    client = get_s3_client()
    key = native.file_key

    def finish(file_key: str, decision, reused: bool) -> dict:
        row.bucket = bucket
        row.file_key = file_key
        row.format = "cog"
        row.status = STATUS_AVAILABLE
        row.georef_status = decision.status
        row.georef_note = decision.note or None
        row.last_accessed = datetime.now(timezone.utc)
        session.commit()
        return {
            "ok": True,
            "key": file_key,
            "format": "cog",
            "reused_native": reused,
            "georef": decision.status,
        }

    suffix = Path(key).suffix or ".tif"
    with tempfile.TemporaryDirectory(prefix="raster-") as tmp:
        work = Path(tmp)
        src = work / f"native{suffix}"
        downloaded = False
        doc = None
        try:
            url = client.generate_presigned_url(
                "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=3600
            )
            doc = gdalinfo_json(f"/vsicurl/{url}", _run, timeout=180)
        except Exception as exc:
            # Fall back to a local copy, e.g. when outbound HTTPS to S3 is blocked.
            logger.warning("Remote raster header read failed for %s: %s", key, exc)
        if doc is None:
            _download(bucket, key, src)
            downloaded = True
            try:
                doc = gdalinfo_json(str(src), _run, timeout=180)
            except Exception as exc:
                raise ConversionError(f"GDAL cannot read this raster: {exc}") from exc

        def structural_cog() -> bool:
            # rio-cogeo on the local copy when there is one, else over S3.
            if downloaded:
                verdict = rio_cog_validate(str(src))
                if verdict is not None:
                    return verdict
            return is_s3_object_cog(client, bucket, key)

        plan = plan_raster(doc, structural_cog, candidates, region)
        logger.info(
            "Raster %s: georef=%s reuse_native=%s assign_crs=%s gcps=%s",
            key,
            plan.decision.status,
            plan.reuse_native,
            plan.decision.assign_crs,
            plan.decision.warp_gcps,
        )
        if plan.reuse_native:
            return finish(key, plan.decision, True)

        if not downloaded:
            _download(bucket, key, src)
        out = convert_cog(
            src,
            work / "out" / "converted.tif",
            timeout=1700,
            assign_srs=plan.decision.assign_crs,
            warp_gcps=plan.decision.warp_gcps,
        )
        try:
            decision = verify_output(
                gdalinfo_json(str(out), _run, timeout=120),
                plan.decision,
                candidates,
                region,
            )
        except Exception:
            logger.exception("Could not verify the raster derivative for %s", key)
            decision = plan.decision
        if decision.status == GEOREF_UNPLACEABLE:
            return finish(key, decision, True)

        dest_key = f"converted/{native.file_id}/{row.cloud_file_id}.tif"
        _upload(bucket, dest_key, out, mime_for_cloud_format("cog"))
        return finish(dest_key, decision, False)


@celery_app.task(
    name="cpu.convert_file",
    bind=True,
    acks_late=True,
    soft_time_limit=1800,
    time_limit=2100,
)
def convert_file(self, cloud_file_id: str) -> dict:
    import sys
    from pathlib import Path

    root = str(Path(__file__).resolve().parent.parent)
    if root not in sys.path:
        sys.path.insert(0, root)

    from datetime import datetime, timezone

    try:
        from db.sync_session import SyncSession
        from models.converted_file import ConvertedFile
        from models.file import File
        from services.conversion import ConversionError, convert_native
        from services.formats import (
            STATUS_AVAILABLE,
            STATUS_REMOVED,
            mime_for_cloud_format,
            plan_for_format,
        )
    except Exception:
        logger.exception("Conversion worker cannot import application packages")
        raise

    session = SyncSession()
    try:
        row = session.get(ConvertedFile, UUID(cloud_file_id))
        if row is None:
            logger.warning("converted_files row missing: %s", cloud_file_id)
            return {"ok": False, "error": "missing"}
        native = session.get(File, row.native_file_id)
        if native is None:
            row.status = STATUS_REMOVED
            session.commit()
            return {"ok": False, "error": "native missing"}
        plan = plan_for_format(native.file_format, native.file_key)
        if plan is None or plan.conversion == "none":
            row.status = STATUS_REMOVED
            session.commit()
            return {"ok": False, "error": "unsupported"}

        bucket = native.bucket or settings.S3_BUCKET

        if plan.conversion == "cog":
            try:
                return _convert_raster(session, row, native, bucket)
            except SoftTimeLimitExceeded:
                raise
            except ConversionError as exc:
                logger.exception("Raster conversion failed for %s: %s", cloud_file_id, exc)
                row.status = STATUS_REMOVED
                session.commit()
                return {"ok": False, "error": str(exc)}

        suffix = Path(native.file_key).suffix or ".bin"
        with tempfile.TemporaryDirectory(prefix="convert-") as tmp:
            work = Path(tmp)
            src = work / f"native{suffix}"
            _download(bucket, native.file_key, src)
            try:
                out_path, out_fmt = convert_native(
                    src, work / "out", plan.conversion, timeout=1700
                )
            except SoftTimeLimitExceeded:
                raise
            except ConversionError as exc:
                logger.exception("Conversion failed for %s: %s", cloud_file_id, exc)
                row.status = STATUS_REMOVED
                session.commit()
                return {"ok": False, "error": str(exc)}

            dest_key = f"converted/{native.file_id}/{row.cloud_file_id}{out_path.suffix}"
            _upload(bucket, dest_key, out_path, mime_for_cloud_format(out_fmt))
            row.bucket = bucket
            row.file_key = dest_key
            row.format = out_fmt
            row.status = STATUS_AVAILABLE
            row.last_accessed = datetime.now(timezone.utc)
            session.commit()
            return {"ok": True, "key": dest_key, "format": out_fmt}
    except SoftTimeLimitExceeded:
        logger.exception("Conversion timed out for %s", cloud_file_id)
        try:
            row = session.get(ConvertedFile, UUID(cloud_file_id))
            if row is not None:
                row.status = STATUS_REMOVED
                session.commit()
        except Exception:
            session.rollback()
        return {"ok": False, "error": "timeout"}
    except Exception:
        logger.exception("Unexpected conversion error for %s", cloud_file_id)
        session.rollback()
        try:
            row = session.get(ConvertedFile, UUID(cloud_file_id))
            if row is not None:
                row.status = STATUS_REMOVED
                session.commit()
        except Exception:
            session.rollback()
        return {"ok": False, "error": "unexpected"}
    finally:
        session.close()


@celery_app.task(name="cpu.cleanup_orphaned_uploads")
def cleanup_orphaned_uploads() -> dict:
    import json
    from datetime import datetime, timedelta, timezone

    import redis
    from db.sync_session import SyncSession
    from services.orphan_cleanup import cleanup_orphaned_uploads as run_cleanup

    if not settings.AUTO_REMOVE_ORPHANED_UPLOADS:
        return {"ok": True, "skipped": True}

    hours = max(1, int(settings.ORPHANED_UPLOAD_EXPIRY_HOURS))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
    jobs = redis.Redis.from_url(settings.UPLOAD_JOBS_BACKEND)

    def job_is_open(job_id) -> bool:
        raw = jobs.get(f"job:{job_id}")
        if not raw:
            return False
        try:
            return json.loads(raw).get("status") in ("open", "in_progress")
        except ValueError:
            return True

    session = SyncSession()
    try:
        counts = run_cleanup(session, get_s3_client(), job_is_open, cutoff)
        logger.info("Orphaned upload cleanup: %s", counts)
        return {"ok": True, **counts}
    except Exception:
        session.rollback()
        logger.exception("Orphaned upload cleanup failed")
        return {"ok": False}
    finally:
        session.close()
        jobs.close()


@celery_app.task(name="cpu.purge_expired_converted_files")
def purge_expired_converted_files() -> dict:
    from datetime import datetime, timedelta, timezone

    from db.sync_session import SyncSession
    from models.converted_file import ConvertedFile
    from services.formats import STATUS_AVAILABLE, STATUS_REMOVED

    if not settings.AUTO_REMOVE_CONVERTED_FILES:
        return {"ok": True, "removed": 0, "skipped": True}

    days = max(1, int(settings.CONVERTED_FILES_EXPIRY_TIME_DAYS))
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    session = SyncSession()
    removed = 0
    try:
        from sqlalchemy import select

        rows = list(
            session.execute(
                select(ConvertedFile)
                .where(ConvertedFile.status == STATUS_AVAILABLE)
                .where(ConvertedFile.last_accessed.isnot(None))
                .where(ConvertedFile.last_accessed < cutoff)
            ).scalars().all()
        )
        from models.file import File

        client = get_s3_client()
        for row in rows:
            native = session.get(File, row.native_file_id)
            shares_native_key = (
                native is not None and row.file_key and row.file_key == native.file_key
            )
            if not shares_native_key and row.file_key:
                try:
                    client.delete_object(Bucket=row.bucket, Key=row.file_key)
                except Exception:
                    logger.warning("Failed to delete expired converted key %s", row.file_key)
            row.status = STATUS_REMOVED
            removed += 1
        session.commit()
        return {"ok": True, "removed": removed}
    except Exception:
        session.rollback()
        logger.exception("Failed to purge expired converted files")
        return {"ok": False, "removed": removed}
    finally:
        session.close()
