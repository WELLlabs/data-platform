from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import boto3
import pytest
from moto import mock_aws
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from models.base import Base
from models.file import File
from models.orphaned_s3_object import OrphanedS3Object
from services.orphan_cleanup import _abort_stale_multipart, cleanup_orphaned_uploads

BUCKET = "test-bucket"
NOW = datetime.now(timezone.utc)
CUTOFF = NOW - timedelta(hours=24)


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[Base.metadata.tables["orphaned_s3_objects"], Base.metadata.tables["files"]],
    )
    session = sessionmaker(bind=engine, expire_on_commit=False)()
    yield session
    session.close()


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("s3", region_name="ap-south-1")
        client.create_bucket(
            Bucket=BUCKET, CreateBucketConfiguration={"LocationConstraint": "ap-south-1"}
        )
        yield client


def orphan(db, s3, key, hours_ago, status="initiated", job_id=None, upload=True):
    row = OrphanedS3Object(
        file_id=uuid4(),
        job_id=job_id or uuid4(),
        file_key=key,
        bucket=BUCKET,
        status=status,
        created_at=NOW - timedelta(hours=hours_ago),
    )
    db.add(row)
    db.commit()
    if upload:
        s3.put_object(Bucket=BUCKET, Key=key, Body=b"data")
    return row


def keys(s3):
    return {o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


def test_cleanup_removes_only_abandoned_uploads(db, s3):
    open_job = uuid4()
    abandoned = orphan(db, s3, "u1/abandoned.csv", 30)
    failed_save = orphan(db, s3, "u1/failed_save.csv", 30, status="orphaned")
    in_use = orphan(db, s3, "u1/in_use.csv", 30, status="orphaned")
    db.add(File(file_id=uuid4(), file_title="t", file_key="u1/in_use.csv", dataset_id=uuid4()))
    db.commit()
    recent = orphan(db, s3, "u1/recent.csv", 2)
    still_open = orphan(db, s3, "u1/open_job.csv", 30, job_id=open_job)
    old_attempt = orphan(db, s3, "u1/reupload.csv", 30)
    orphan(db, s3, "u1/reupload.csv", 1)
    done = orphan(db, s3, "u1/done.csv", 30, status="completed")
    s3.put_object(Bucket=BUCKET, Key="other-pipeline/raw.tif", Body=b"not ours")

    counts = cleanup_orphaned_uploads(db, s3, lambda job: job == open_job, CUTOFF)

    assert counts == {"deleted": 2, "in_use": 1, "skipped": 2, "aborted_uploads": 0, "failed": 0}
    assert keys(s3) == {
        "u1/in_use.csv",
        "u1/recent.csv",
        "u1/open_job.csv",
        "u1/reupload.csv",
        "u1/done.csv",
        "other-pipeline/raw.tif",
    }
    statuses = {r.file_key: r.status for r in (abandoned, failed_save, in_use, recent, still_open, done)}
    assert statuses == {
        "u1/abandoned.csv": "deleted",
        "u1/failed_save.csv": "deleted",
        "u1/in_use.csv": "in_use",
        "u1/recent.csv": "initiated",
        "u1/open_job.csv": "initiated",
        "u1/done.csv": "completed",
    }
    assert old_attempt.status == "initiated"

    # A second run finds nothing new to do.
    again = cleanup_orphaned_uploads(db, s3, lambda job: job == open_job, CUTOFF)
    assert again["deleted"] == 0


def test_missing_objects_are_still_marked_deleted(db, s3):
    row = orphan(db, s3, "u1/never_uploaded.csv", 30, upload=False)
    counts = cleanup_orphaned_uploads(db, s3, lambda job: False, CUTOFF)
    assert counts["deleted"] == 1
    assert row.status == "deleted"


def test_unfinished_multipart_uploads_for_the_key_are_aborted(s3):
    stale = s3.create_multipart_upload(Bucket=BUCKET, Key="u1/big.tif")["UploadId"]
    s3.create_multipart_upload(Bucket=BUCKET, Key="u1/big.tif.other")
    future = datetime.now(timezone.utc) + timedelta(minutes=1)
    assert _abort_stale_multipart(s3, BUCKET, "u1/big.tif", future) == 1
    remaining = s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads", [])
    assert [u["Key"] for u in remaining] == ["u1/big.tif.other"]
    assert stale not in {u["UploadId"] for u in remaining}


def test_recent_multipart_uploads_are_left_alone():
    aborted = []
    client = SimpleNamespace(
        list_multipart_uploads=lambda **kw: {
            "Uploads": [{"Key": "u1/big.tif", "UploadId": "u", "Initiated": NOW - timedelta(hours=2)}]
        },
        abort_multipart_upload=lambda **kw: aborted.append(kw),
    )
    assert _abort_stale_multipart(client, BUCKET, "u1/big.tif", CUTOFF) == 0
    assert aborted == []
