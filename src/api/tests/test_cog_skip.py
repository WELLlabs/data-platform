import asyncio
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

import services.cog_check as cog_check
from models.converted_file import ConvertedFile
from services.formats import STATUS_AVAILABLE, STATUS_PROCESSING
from services.visualization import VisualizationService
from tests.fakes import FakeSession


class Service(VisualizationService):
    def __init__(self):
        super().__init__(FakeSession(), None)
        self.enqueued = []
        self.rows = []

    async def _rows(self, native_file_id, include_removed=False):
        return [r for r in self.rows if include_removed or r.status != "removed"]

    async def _touch_and_log(self, converted, user):
        pass

    async def _presign(self, converted):
        return {"access_url": f"https://example/{converted.file_key}"}

    def _enqueue_conversion(self, cloud_file_id):
        self.enqueued.append(cloud_file_id)


async def _refresh(obj):
    return None


@pytest.fixture
def service(monkeypatch):
    svc = Service()
    svc.session.refresh = _refresh
    monkeypatch.setattr("services.upload.get_s3_client", lambda: object())
    return svc


def geotiff(name="scene.tif", fmt="tif"):
    return SimpleNamespace(file_id=uuid4(), file_format=fmt, file_key=f"u/{name}", bucket="b")


FIXTURES = Path(__file__).parent / "fixtures" / "rasters"


def serve_fixture(monkeypatch, name):
    blob = (FIXTURES / name).read_bytes()

    def inspect(client, bucket, key):
        return cog_check.inspect_tiff(lambda offset, length: blob[offset:offset + length])

    monkeypatch.setattr(cog_check, "inspect_s3_tiff", inspect)


def test_uploaded_cog_is_served_without_conversion(service, monkeypatch):
    serve_fixture(monkeypatch, "cog_wgs84.tif")
    native = geotiff()
    body = asyncio.run(service.access_file(native, None))
    assert service.enqueued == []
    assert body["status"] == STATUS_AVAILABLE
    assert body["format"] == "cog"
    assert body["georef_status"] == "ok"
    row = next(o for o in service.session.added if isinstance(o, ConvertedFile))
    assert row.file_key == native.file_key


def test_projected_cog_is_served_without_conversion(service, monkeypatch):
    serve_fixture(monkeypatch, "cog_utm43.tif")
    body = asyncio.run(service.access_file(geotiff(), None))
    assert service.enqueued == [] and body["status"] == STATUS_AVAILABLE


def test_cog_named_file_with_a_wrong_crs_goes_to_the_worker(service, monkeypatch):
    # Like lulc250k_2015_16_cog.tif: a real COG, labelled EPSG:4326, in metres.
    serve_fixture(monkeypatch, "cog_lcc_labelled_wgs84.tif")
    body = asyncio.run(service.access_file(geotiff("lulc_cog.tif", "cog"), None))
    assert len(service.enqueued) == 1
    assert body["status"] == STATUS_PROCESSING


def test_cog_without_crs_goes_to_the_worker(service, monkeypatch):
    serve_fixture(monkeypatch, "cog_no_crs_metres.tif")
    asyncio.run(service.access_file(geotiff(), None))
    assert len(service.enqueued) == 1


def test_plain_geotiff_is_still_converted(service, monkeypatch):
    serve_fixture(monkeypatch, "striped_wgs84.tif")
    body = asyncio.run(service.access_file(geotiff(), None))
    assert len(service.enqueued) == 1
    assert body["status"] == STATUS_PROCESSING


def test_other_formats_never_run_the_cog_check(service, monkeypatch):
    def fail(*args):
        raise AssertionError("COG check should not run")

    monkeypatch.setattr(cog_check, "inspect_s3_tiff", fail)
    asyncio.run(service.access_file(geotiff("table.csv", "csv"), None))
    asyncio.run(service.access_file(geotiff("data.parquet", "parquet"), None))


def record(native, key, georef="ok", status=STATUS_AVAILABLE):
    return ConvertedFile(
        cloud_file_id=uuid4(),
        native_file_id=native.file_id,
        bucket="b",
        file_key=key,
        format="cog",
        status=status,
        georef_status=georef,
    )


def no_s3(monkeypatch):
    def fail(*args):
        raise AssertionError("S3 should not be read")

    monkeypatch.setattr(cog_check, "inspect_s3_tiff", fail)


def test_cog_found_on_an_earlier_view_is_served_without_reading_s3(service, monkeypatch):
    native = geotiff()
    service.rows = [record(native, native.file_key)]
    no_s3(monkeypatch)
    body = asyncio.run(service.access_file(native, None))
    assert body["status"] == STATUS_AVAILABLE and service.enqueued == []
    assert body["access_url"].endswith(native.file_key)


def test_our_converted_copy_is_reused_without_reading_s3(service, monkeypatch):
    native = geotiff()
    copy = record(native, f"converted/{native.file_id}/x.tif")
    service.rows = [copy]
    no_s3(monkeypatch)
    body = asyncio.run(service.access_file(native, None))
    assert service.enqueued == []
    assert body["access_url"].endswith(copy.file_key)


def test_a_newer_failed_attempt_does_not_hide_a_working_copy(service, monkeypatch):
    native = geotiff()
    good = record(native, f"converted/{native.file_id}/good.tif")
    failed = record(native, "", status="removed")
    service.rows = [failed, good]
    no_s3(monkeypatch)
    body = asyncio.run(service.access_file(native, None))
    assert body["access_url"].endswith("good.tif") and service.enqueued == []


def test_running_conversion_is_not_started_twice(service, monkeypatch):
    serve_fixture(monkeypatch, "striped_wgs84.tif")
    native = geotiff()
    running = record(native, "", georef=None, status=STATUS_PROCESSING)
    from datetime import datetime, timezone

    running.created_on = datetime.now(timezone.utc)
    service.rows = [running]
    body = asyncio.run(service.access_file(native, None))
    assert service.enqueued == [] and body["status"] == STATUS_PROCESSING


def test_older_sound_cog_record_is_kept_not_redone(service, monkeypatch):
    # Recorded before georeferencing was checked; the header shows it is fine.
    native = geotiff()
    old = record(native, native.file_key, georef=None)
    service.rows = [old]
    serve_fixture(monkeypatch, "cog_utm43.tif")
    body = asyncio.run(service.access_file(native, None))
    assert old.status == STATUS_AVAILABLE and old.georef_status == "ok"
    assert service.enqueued == [] and body["status"] == STATUS_AVAILABLE


def test_older_record_with_a_wrong_crs_is_redone(service, monkeypatch):
    native = geotiff()
    old = record(native, native.file_key, georef=None)
    service.rows = [old]
    serve_fixture(monkeypatch, "cog_lcc_labelled_wgs84.tif")
    body = asyncio.run(service.access_file(native, None))
    assert old.status == "removed"
    assert len(service.enqueued) == 1
    assert body["status"] == STATUS_PROCESSING


def test_failed_conversion_is_reported_to_the_polling_preview(service):
    native = geotiff()
    service.rows = [record(native, "", georef=None, status="removed")]
    body = asyncio.run(service.conversion_status(native))
    assert body["status"] == "removed" and "error" in body
