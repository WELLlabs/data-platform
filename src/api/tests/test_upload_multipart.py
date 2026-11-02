import asyncio
import json
from types import SimpleNamespace
from urllib.parse import urlparse
from uuid import uuid4

import pytest
import requests
from botocore.exceptions import ClientError
from fastapi import HTTPException
from fastapi.responses import JSONResponse
from moto import mock_aws

import routers.upload as upload_router
import services.upload as upload_module
from core.config import settings
from models.orphaned_s3_object import OrphanedS3Object
from routers.upload import UploadController, _extend_session
from schemas.file import (
    CompleteMultipartRequest,
    MultipartPartUrlsRequest,
    MultipartSessionRequest,
)
from services.auth import AuthService
from services.upload import (
    INITIAL_PART_URLS,
    MAX_MULTIPART_PARTS,
    MIN_MULTIPART_PART_BYTES,
    MULTIPART_THRESHOLD_BYTES,
    S3_PUT_OBJECT_MAX_BYTES,
    UploadService,
)
from tests.fakes import FakeRedis, FakeSession

GIB = 1024 ** 3
MIB = 1024 ** 2
BUCKET = settings.S3_BUCKET


def run(coro):
    return asyncio.run(coro)


def body(resp):
    return json.loads(resp.body)


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setattr(settings, "AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setattr(settings, "AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setattr(upload_module, "_s3_client", None)
    with mock_aws():
        client = upload_module.get_s3_client()
        client.create_bucket(
            Bucket=BUCKET,
            CreateBucketConfiguration={"LocationConstraint": settings.S3_REGION},
        )
        yield client
    upload_module._s3_client = None


@pytest.fixture
def ctx():
    user = SimpleNamespace(id=uuid4())
    redis = FakeRedis()
    jid = str(uuid4())
    redis.data[f"job:{jid}"] = json.dumps({"job_id": jid, "creator": str(user.id), "status": "open"})
    redis.data[f"job:{jid}:events"] = "[]"
    session = FakeSession()
    controller = UploadController(UploadService(), session, None, None, None, redis)
    return SimpleNamespace(user=user, redis=redis, jid=jid, session=session, controller=controller)


def start_upload(ctx, size, name="big.tif"):
    return body(run(ctx.controller.get_upload_url(ctx.jid, name, ctx.user, size)))


@pytest.mark.parametrize("size", [5 * GIB + 1, 6_000_000_000, 20 * GIB, 50 * GIB])
def test_part_plan_is_valid_for_files_above_5gb(size):
    part_size = UploadService.part_size_for(size)
    part_count = -(-size // part_size)
    assert MIN_MULTIPART_PART_BYTES <= part_size <= S3_PUT_OBJECT_MAX_BYTES
    assert part_count <= MAX_MULTIPART_PARTS
    assert (part_count - 1) * part_size < size <= part_count * part_size


def test_threshold_is_below_the_single_put_limit():
    assert MULTIPART_THRESHOLD_BYTES < S3_PUT_OBJECT_MAX_BYTES


@pytest.mark.parametrize(
    "size, multipart",
    [(10 * MIB, False), (64 * MIB, False), (64 * MIB + 1, True), (400 * MIB, True), (6 * GIB, True)],
)
def test_large_files_use_multipart(s3, ctx, size, multipart):
    data = start_upload(ctx, size)
    assert bool(data.get("multipart")) is multipart
    row = ctx.session.added[-1]
    assert isinstance(row, OrphanedS3Object) and row.status == "initiated"


def test_6gb_upload_returns_only_the_first_part_urls(s3, ctx):
    size = 6_000_000_000
    data = start_upload(ctx, size)
    assert data["part_count"] == -(-size // data["part_size"]) == 358
    assert [p["part_number"] for p in data["parts"]] == list(range(1, INITIAL_PART_URLS + 1))
    host = urlparse(data["parts"][0]["url"]).hostname
    assert host == f"{BUCKET}.s3.{settings.S3_REGION}.amazonaws.com"
    record = json.loads(ctx.redis.data[f"multipart:{data['file_id']}"])
    assert record["part_count"] == 358
    uploads = s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads", [])
    assert [u["Key"] for u in uploads] == [f"{ctx.user.id}/big.tif"]


def test_upload_above_the_size_limit_is_rejected(ctx):
    with pytest.raises(HTTPException) as exc:
        start_upload(ctx, int(settings.S3_UPLOAD_MAX_SIZE) + 1)
    assert exc.value.status_code == 400


def part_urls(ctx, data, numbers, user=None, upload_id=None):
    req = MultipartPartUrlsRequest(
        job_id=ctx.jid,
        file_id=data["file_id"],
        upload_id=upload_id or data["upload_id"],
        part_numbers=numbers,
    )
    return run(ctx.controller.multipart_part_urls(req, user or ctx.user))


def test_later_part_urls_are_signed_on_demand_and_keep_the_job_alive(s3, ctx):
    data = start_upload(ctx, 6_000_000_000)
    ctx.redis.expired.clear()
    parts = body(part_urls(ctx, data, [358, 17, 17, 100]))["parts"]
    assert [p["part_number"] for p in parts] == [17, 100, 358]
    assert all("partNumber=" in p["url"] for p in parts)
    assert set(ctx.redis.expired) == {
        f"job:{ctx.jid}",
        f"job:{ctx.jid}:events",
        f"multipart:{data['file_id']}",
    }


@pytest.mark.parametrize("numbers", [[0], [359], [1, 400]])
def test_part_numbers_outside_the_upload_are_rejected(s3, ctx, numbers):
    data = start_upload(ctx, 6_000_000_000)
    with pytest.raises(HTTPException) as exc:
        part_urls(ctx, data, numbers)
    assert exc.value.status_code == 400


def test_part_urls_require_the_owner_and_the_right_upload(s3, ctx):
    data = start_upload(ctx, 6_000_000_000)
    with pytest.raises(HTTPException) as exc:
        part_urls(ctx, data, [2], user=SimpleNamespace(id=uuid4()))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        part_urls(ctx, data, [2], upload_id="someone-elses-upload")
    assert exc.value.status_code == 400


def test_at_most_100_part_urls_per_request():
    with pytest.raises(ValueError):
        MultipartPartUrlsRequest(
            job_id="j", file_id=uuid4(), upload_id="u", part_numbers=list(range(1, 102))
        )


def complete(ctx, data, parts):
    req = CompleteMultipartRequest(
        job_id=ctx.jid, file_id=data["file_id"], upload_id=data["upload_id"], parts=parts
    )
    return run(ctx.controller.complete_multipart(req, ctx.user))


def test_multipart_upload_end_to_end(s3, ctx, monkeypatch):
    """Scaled-down version of the >5 GB path: real bytes through presigned part URLs."""
    monkeypatch.setattr(upload_module, "MIN_MULTIPART_PART_BYTES", 5 * MIB)
    monkeypatch.setattr(upload_module, "INITIAL_PART_URLS", 2)
    monkeypatch.setattr(upload_router, "MULTIPART_THRESHOLD_BYTES", 1 * MIB)
    payload = bytes(range(256)) * (15 * MIB // 256) + b"tail"
    data = start_upload(ctx, len(payload), name="scene.tif")
    assert data["part_count"] == 4
    urls = {p["part_number"]: p["url"] for p in data["parts"]}
    for p in body(part_urls(ctx, data, [3, 4]))["parts"]:
        urls[p["part_number"]] = p["url"]

    etags = []
    size = data["part_size"]
    for n in range(1, 5):
        resp = requests.put(urls[n], data=payload[(n - 1) * size:n * size])
        assert resp.status_code == 200
        etags.append({"part_number": n, "etag": resp.headers["ETag"]})

    assert complete(ctx, data, etags).status_code == 200
    obj = s3.get_object(Bucket=BUCKET, Key=f"{ctx.user.id}/scene.tif")
    assert obj["ContentLength"] == len(payload)
    assert obj["Body"].read() == payload

    # A retry after a lost response must not fail the upload.
    assert complete(ctx, data, etags).status_code == 200
    with pytest.raises(HTTPException) as exc:
        part_urls(ctx, data, [1])
    assert exc.value.status_code == 409


def test_service_complete_is_idempotent(s3):
    service = UploadService()
    key = "u/file.bin"
    upload_id = s3.create_multipart_upload(Bucket=BUCKET, Key=key)["UploadId"]
    etag = s3.upload_part(
        Bucket=BUCKET, Key=key, UploadId=upload_id, PartNumber=1, Body=b"x" * 10
    )["ETag"]
    parts = [{"part_number": 1, "etag": etag}]
    run(service.complete_multipart_upload(key, upload_id, parts))
    run(service.complete_multipart_upload(key, upload_id, parts))


def _client_error(code, op):
    return ClientError({"Error": {"Code": code, "Message": code}}, op)


def test_completing_an_expired_session_says_so(monkeypatch):
    def complete_multipart_upload(**kwargs):
        raise _client_error("NoSuchUpload", "CompleteMultipartUpload")

    def head_object(**kwargs):
        raise _client_error("404", "HeadObject")

    client = SimpleNamespace(
        complete_multipart_upload=complete_multipart_upload, head_object=head_object
    )
    monkeypatch.setattr(upload_module, "_s3_client", client)
    with pytest.raises(HTTPException) as exc:
        run(UploadService().complete_multipart_upload("u/x", "gone", [{"part_number": 1, "etag": "e"}]))
    assert exc.value.status_code == 410


class StubStorage(UploadService):
    def __init__(self, error):
        super().__init__()
        self.error = error
        self.aborted = []

    async def complete_multipart_upload(self, file_key, upload_id, parts):
        raise self.error

    async def abort_multipart_upload(self, file_key, upload_id):
        self.aborted.append(upload_id)


def stub_session(ctx, error):
    file_id = str(uuid4())
    ctx.controller.upload_service = StubStorage(error)
    ctx.redis.data[f"multipart:{file_id}"] = json.dumps(
        {"job_id": ctx.jid, "upload_id": "up-1", "key": "k", "creator": str(ctx.user.id), "part_count": 3}
    )
    return {"file_id": file_id, "upload_id": "up-1"}


def test_transient_complete_failure_keeps_the_uploaded_parts(ctx):
    data = stub_session(ctx, HTTPException(status_code=502, detail="S3 service unavailable"))
    with pytest.raises(HTTPException):
        complete(ctx, data, [{"part_number": 1, "etag": "e"}])
    assert ctx.controller.upload_service.aborted == []
    assert f"multipart:{data['file_id']}" in ctx.redis.data


def test_rejected_parts_abort_the_upload(ctx):
    data = stub_session(ctx, HTTPException(status_code=400, detail="InvalidPart"))
    with pytest.raises(HTTPException):
        complete(ctx, data, [{"part_number": 1, "etag": "e"}])
    assert ctx.controller.upload_service.aborted == ["up-1"]
    assert f"multipart:{data['file_id']}" not in ctx.redis.data


def test_abort_frees_parts_and_marks_the_row(s3, ctx):
    data = start_upload(ctx, 400 * MIB)
    req = MultipartSessionRequest(job_id=ctx.jid, file_id=data["file_id"], upload_id=data["upload_id"])
    run(ctx.controller.abort_multipart(req, ctx.user))
    assert s3.list_multipart_uploads(Bucket=BUCKET).get("Uploads", []) == []
    assert f"multipart:{data['file_id']}" not in ctx.redis.data
    assert "aborted" in ctx.session.executed[-1].compile().params.values()


def test_upload_requests_extend_the_session_cookie():
    redis = FakeRedis()
    redis.data["session:abc"] = "user-id"
    auth = SimpleNamespace(redis=redis, session_cookie=AuthService.session_cookie)
    auth.extend_session = lambda token: AuthService.extend_session(auth, token)
    request = SimpleNamespace(cookies={settings.COOKIE_NAME: "session:abc"})

    resp = run(_extend_session(request, JSONResponse({}), auth))
    assert redis.expired == ["session:abc"]
    cookie = resp.headers["set-cookie"]
    assert "session:abc" in cookie and f"Max-Age={settings.COOKIE_MAX_AGE_SECONDS}" in cookie

    request.cookies[settings.COOKIE_NAME] = "session:gone"
    resp = run(_extend_session(request, JSONResponse({}), auth))
    assert "set-cookie" not in resp.headers
