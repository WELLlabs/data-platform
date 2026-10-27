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
        from services.conversion import ConversionError, convert_native, is_cog
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
        suffix = Path(native.file_key).suffix or ".bin"
        with tempfile.TemporaryDirectory(prefix="convert-") as tmp:
            work = Path(tmp)
            src = work / f"native{suffix}"
            _download(bucket, native.file_key, src)
            if plan.conversion == "cog" and is_cog(src, timeout=120):
                row.bucket = bucket
                row.file_key = native.file_key
                row.format = "cog"
                row.status = STATUS_AVAILABLE
                row.last_accessed = datetime.now(timezone.utc)
                session.commit()
                return {"ok": True, "key": native.file_key, "format": "cog", "reused_native": True}
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
