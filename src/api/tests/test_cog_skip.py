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

    async def latest_converted(self, native_file_id):
        return None

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


def test_raster_previewed_before_the_check_is_rechecked(monkeypatch):
    native = geotiff()
    old = ConvertedFile(
        cloud_file_id=uuid4(),
        native_file_id=native.file_id,
        bucket="b",
        file_key=native.file_key,
        format="cog",
        status=STATUS_AVAILABLE,
        georef_status=None,
    )

    class Legacy(Service):
        async def latest_converted(self, native_file_id):
            return old

    svc = Legacy()
    svc.session.refresh = _refresh
    monkeypatch.setattr("services.upload.get_s3_client", lambda: object())
    serve_fixture(monkeypatch, "cog_lcc_labelled_wgs84.tif")
    body = asyncio.run(svc.access_file(native, None))
    assert old.status == "removed"
    assert len(svc.enqueued) == 1
    assert body["status"] == STATUS_PROCESSING
