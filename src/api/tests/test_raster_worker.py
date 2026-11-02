"""The worker's raster path, with GDAL, S3, and the database faked."""

from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest

import tasks.cpu as cpu
from tests.test_raster_georef import LULC_GT
from tests.test_raster_inspect import doc


class Session:
    commits = 0

    def commit(self):
        self.commits += 1


class Client:
    def generate_presigned_url(self, op, Params, ExpiresIn):
        return f"https://s3.example/{Params['Key']}?X-Amz-Signature=abc"


@pytest.fixture
def world(monkeypatch):
    calls = {"download": 0, "upload": [], "convert": [], "info": []}
    docs = {}

    def gdalinfo_json(source, run, timeout=120):
        calls["info"].append(source)
        key = "out" if source.endswith("converted.tif") else "remote" if source.startswith("/vsicurl/") else "local"
        value = docs.get(key)
        if isinstance(value, Exception):
            raise value
        return value

    def convert_cog(src, dest, timeout, assign_srs=None, warp_gcps=False):
        calls["convert"].append((assign_srs, warp_gcps))
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"cog")
        return dest

    monkeypatch.setattr("services.raster_inspect.gdalinfo_json", gdalinfo_json)
    monkeypatch.setattr("services.conversion.convert_cog", convert_cog)
    monkeypatch.setattr("services.cog_check.is_s3_object_cog", lambda c, b, k: False)
    monkeypatch.setattr(cpu, "get_s3_client", lambda: Client())
    monkeypatch.setattr(cpu, "_download", lambda b, k, d: calls.__setitem__("download", calls["download"] + 1))
    monkeypatch.setattr(cpu, "_upload", lambda b, k, s, t: calls["upload"].append(k))
    return calls, docs


def records():
    native = SimpleNamespace(file_id=uuid4(), file_key="u/lulc_cog.tif")
    row = SimpleNamespace(cloud_file_id=uuid4())
    return native, row


def test_sound_cog_is_reused_without_download(world):
    calls, docs = world
    docs["remote"] = doc()
    native, row = records()
    out = cpu._convert_raster(Session(), row, native, "b")
    assert out["reused_native"] and row.file_key == native.file_key
    assert row.georef_status == "ok" and row.georef_note is None
    assert calls["download"] == 0 and calls["convert"] == []
    # The presigned query string reaches GDAL but nothing is uploaded.
    assert calls["info"][0].startswith("/vsicurl/https://s3.example/u/lulc_cog.tif?")


def test_mislabelled_lulc_gets_a_fixed_derivative(world):
    calls, docs = world
    docs["remote"] = doc(gt=LULC_GT, size=(62271, 63818))
    docs["out"] = doc(gt=LULC_GT, size=(62271, 63818), wkt="EPSG:7755")
    native, row = records()
    out = cpu._convert_raster(Session(), row, native, "b")
    assert calls["convert"] == [("EPSG:7755", False)]
    assert calls["download"] == 1
    assert row.file_key == f"converted/{native.file_id}/{row.cloud_file_id}.tif"
    assert calls["upload"] == [row.file_key]
    assert row.georef_status == "assumed" and "EPSG:7755" in row.georef_note
    assert out["georef"] == "assumed"


def test_remote_read_failure_falls_back_to_a_download(world):
    calls, docs = world
    docs["remote"] = RuntimeError("HTTP blocked")
    docs["local"] = doc()
    native, row = records()
    cpu._convert_raster(Session(), row, native, "b")
    assert calls["download"] == 1 and row.georef_status == "ok"


def test_unreadable_raster_raises_a_conversion_error(world):
    from services.conversion import ConversionError

    calls, docs = world
    docs["remote"] = RuntimeError("no")
    docs["local"] = RuntimeError("not a raster")
    with pytest.raises(ConversionError):
        native, row = records()
        cpu._convert_raster(Session(), row, native, "b")


def test_fix_that_does_not_verify_is_not_published(world):
    calls, docs = world
    docs["remote"] = doc(gt=LULC_GT, size=(62271, 63818))
    docs["out"] = doc(gt=LULC_GT, size=(62271, 63818))  # still labelled 4326
    native, row = records()
    cpu._convert_raster(Session(), row, native, "b")
    assert calls["upload"] == []
    assert row.file_key == native.file_key and row.georef_status == "unplaceable"
