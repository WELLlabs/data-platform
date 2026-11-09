"""rio-cogeo decides whether an upload is already a COG.

A COG must be served to the map as uploaded and never converted again.
"""

import boto3
import pytest
from moto import mock_aws

from services import cog_check

rasterio = pytest.importorskip("rasterio")
pytest.importorskip("rio_cogeo")

import numpy as np  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402
from rio_cogeo.cogeo import cog_translate  # noqa: E402
from rio_cogeo.profiles import cog_profiles  # noqa: E402

BUCKET = "test-bucket"


@pytest.fixture(scope="module")
def rasters(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("rio")
    plain = tmp / "plain.tif"
    cog = tmp / "cog.tif"
    profile = dict(
        driver="GTiff", width=1024, height=1024, count=1, dtype="uint8",
        crs="EPSG:32643", transform=from_origin(700000, 1500000, 30, 30),
    )
    with rasterio.open(plain, "w", **profile) as dst:
        dst.write(np.arange(1024 * 1024, dtype="uint32").reshape(1, 1024, 1024).astype("uint8"))
    cog_translate(str(plain), str(cog), cog_profiles.get("deflate"), quiet=True)
    return {"plain": plain, "cog": cog}


def test_rio_accepts_cog_and_rejects_striped_tiff(rasters):
    assert cog_check.rio_cog_validate(str(rasters["cog"])) is True
    assert cog_check.rio_cog_validate(str(rasters["plain"])) is False


def test_rio_unreadable_file_returns_none(tmp_path):
    bad = tmp_path / "bad.tif"
    bad.write_bytes(b"not a tiff")
    assert cog_check.rio_cog_validate(str(bad)) is None


def test_presigned_query_string_is_not_logged():
    assert cog_check._redact("https://h/k.tif?X-Amz-Signature=s") == "https://h/k.tif"


@pytest.fixture
def s3(rasters):
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1")
        client.create_bucket(Bucket=BUCKET)
        client.upload_file(str(rasters["cog"]), BUCKET, "cog.tif")
        client.upload_file(str(rasters["plain"]), BUCKET, "plain.tif")
        yield client


def test_rio_verdict_wins_over_header_parser(s3, monkeypatch):
    # rio-cogeo says "not a COG" for a file the header parser would accept.
    monkeypatch.setattr(cog_check, "rio_s3_cog_validate", lambda *a: False)
    assert cog_check.is_s3_object_cog(s3, BUCKET, "cog.tif") is False
    assert cog_check.inspect_s3_tiff(s3, BUCKET, "cog.tif").is_cog is False


def test_header_parser_used_when_rio_cannot_read(s3, monkeypatch):
    monkeypatch.setattr(cog_check, "rio_s3_cog_validate", lambda *a: None)
    assert cog_check.is_s3_object_cog(s3, BUCKET, "cog.tif") is True
    assert cog_check.is_s3_object_cog(s3, BUCKET, "plain.tif") is False
    found = cog_check.inspect_s3_tiff(s3, BUCKET, "cog.tif")
    assert found.is_cog is True
    assert found.epsg == 32643


def test_s3_cog_keeps_grid_and_epsg_with_rio_verdict(s3, monkeypatch):
    monkeypatch.setattr(cog_check, "rio_s3_cog_validate", lambda *a: True)
    found = cog_check.inspect_s3_tiff(s3, BUCKET, "cog.tif")
    assert (found.is_cog, found.epsg, found.width) == (True, 32643, 1024)
