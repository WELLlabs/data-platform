"""Remove uploads that never became a dataset file.

Every presigned upload writes an ``orphaned_s3_objects`` row first. A row that
is still pending after the expiry window, whose upload job is closed or gone,
and whose key no ``files`` row uses, points at an abandoned object. The object
is deleted, and any unfinished multipart upload for the key is aborted.

Only keys recorded in that table are touched, so other data in a shared
bucket is safe.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Callable
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError
from models.file import File
from models.orphaned_s3_object import OrphanedS3Object
from sqlalchemy import select
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

PENDING_STATUSES = ("initiated", "orphaned", "aborted")
STATUS_DELETED = "deleted"
STATUS_IN_USE = "in_use"


def _abort_stale_multipart(client: Any, bucket: str, key: str, cutoff: datetime) -> int:
    aborted = 0
    resp = client.list_multipart_uploads(Bucket=bucket, Prefix=key)
    for upload in resp.get("Uploads", []):
        if upload.get("Key") != key or upload.get("Initiated") >= cutoff:
            continue
        client.abort_multipart_upload(
            Bucket=bucket, Key=key, UploadId=upload["UploadId"]
        )
        aborted += 1
    return aborted


def cleanup_orphaned_uploads(
    session: Session,
    client: Any,
    job_is_open: Callable[[UUID], bool],
    cutoff: datetime,
    limit: int = 500,
) -> dict[str, int]:
    """Clean pending rows created before ``cutoff``. Returns counts per outcome."""
    rows = list(
        session.execute(
            select(OrphanedS3Object)
            .where(OrphanedS3Object.status.in_(PENDING_STATUSES))
            .where(OrphanedS3Object.created_at < cutoff)
            .order_by(OrphanedS3Object.created_at)
            .limit(limit)
        ).scalars().all()
    )
    counts = {"deleted": 0, "in_use": 0, "skipped": 0, "aborted_uploads": 0, "failed": 0}
    for row in rows:
        if job_is_open(row.job_id):
            counts["skipped"] += 1
            continue
        in_use = session.execute(
            select(File.file_id).where(File.file_key == row.file_key).limit(1)
        ).first()
        if in_use:
            row.status = STATUS_IN_USE
            session.commit()
            counts["in_use"] += 1
            continue
        # Same key, re-uploaded recently: the object may belong to that upload.
        newer = session.execute(
            select(OrphanedS3Object.file_id)
            .where(OrphanedS3Object.file_key == row.file_key)
            .where(OrphanedS3Object.file_id != row.file_id)
            .where(OrphanedS3Object.created_at >= cutoff)
            .limit(1)
        ).first()
        if newer:
            counts["skipped"] += 1
            continue
        try:
            counts["aborted_uploads"] += _abort_stale_multipart(
                client, row.bucket, row.file_key, cutoff
            )
            client.delete_object(Bucket=row.bucket, Key=row.file_key)
        except (ClientError, BotoCoreError):
            logger.exception("Could not remove orphaned upload %s", row.file_key)
            counts["failed"] += 1
            continue
        row.status = STATUS_DELETED
        session.commit()
        counts["deleted"] += 1
        logger.info("Removed orphaned upload s3://%s/%s", row.bucket, row.file_key)
    return counts
