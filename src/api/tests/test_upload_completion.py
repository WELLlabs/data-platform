import asyncio
import json
from types import SimpleNamespace
from uuid import uuid4

import pytest

import services.upload_completion as completion
from models.file import File
from models.orphaned_s3_object import OrphanedS3Object
from tests.fakes import FakeRedis, FakeResult, FakeSession


class Storage:
    def __init__(self, uploaded):
        self.uploaded = uploaded
        self.checked = []

    async def check_file_status_by_key(self, key):
        self.checked.append(key)
        return {"exists": key in self.uploaded, "size": 42}


@pytest.fixture(autouse=True)
def no_search_index(monkeypatch):
    async def noop(*args, **kwargs):
        return None

    monkeypatch.setattr(completion, "safe_index_dataset", noop)


def test_a_failed_upload_does_not_block_the_files_that_worked():
    user = SimpleNamespace(id=uuid4())
    jid = str(uuid4())
    dataset_id = uuid4()
    ok = OrphanedS3Object(file_id=uuid4(), job_id=jid, file_key=f"{user.id}/ok.csv", bucket="b", status="initiated")
    failed = OrphanedS3Object(file_id=uuid4(), job_id=jid, file_key=f"{user.id}/failed.csv", bucket="b", status="initiated")

    redis = FakeRedis()
    redis.data[f"job:{jid}"] = json.dumps({"job_id": jid, "creator": str(user.id), "status": "open"})
    redis.data[f"job:{jid}:events"] = json.dumps(["file_1"])
    redis.data[f"job:{jid}:event:file_1"] = json.dumps(
        {"file_id": str(ok.file_id), "dataset_id": str(dataset_id), "file_title": "ok.csv", "status": "pending"}
    )
    session = FakeSession([FakeResult([ok, failed]), FakeResult(ok)])
    storage = Storage(uploaded={ok.file_key})
    auth = SimpleNamespace(redis=FakeRedis())

    status = asyncio.run(
        completion.complete_upload_job(jid, user, session, redis, storage, None, auth)
    )

    assert storage.checked == [ok.file_key]
    assert status["status"] == "completed"
    assert status["events"] == [{"file_1": "completed"}]
    saved = [obj for obj in session.added if isinstance(obj, File)]
    assert [f.file_key for f in saved] == [ok.file_key]
    assert ok.status == "completed"
    assert failed.status == "initiated"


def test_a_staged_file_missing_from_storage_still_fails_the_job():
    user = SimpleNamespace(id=uuid4())
    jid = str(uuid4())
    row = OrphanedS3Object(file_id=uuid4(), job_id=jid, file_key="k", bucket="b", status="initiated")
    redis = FakeRedis()
    redis.data[f"job:{jid}"] = json.dumps({"job_id": jid, "creator": str(user.id), "status": "open"})
    redis.data[f"job:{jid}:events"] = json.dumps(["file_1"])
    redis.data[f"job:{jid}:event:file_1"] = json.dumps({"file_id": str(row.file_id)})

    from fastapi import HTTPException

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            completion.complete_upload_job(
                jid, user, FakeSession([FakeResult([row])]), redis, Storage(set()), None, None
            )
        )
    assert exc.value.status_code == 400
