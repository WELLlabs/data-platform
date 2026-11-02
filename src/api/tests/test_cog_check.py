import struct

import boto3
import pytest
from moto import mock_aws

from services.cog_check import is_cog_layout, is_s3_object_cog

_BLOCK = 64


def _value(typ, value, big):
    raw = {3: struct.pack("<H", value), 4: struct.pack("<I", value), 16: struct.pack("<Q", value)}[typ]
    return raw.ljust(8 if big else 4, b"\0")


def _ifd(entries, next_offset, big):
    if big:
        out = struct.pack("<Q", len(entries))
        for tag, typ, value in entries:
            out += struct.pack("<HHQ", tag, typ, 1) + _value(typ, value, big)
        return out + struct.pack("<Q", next_offset)
    out = struct.pack("<H", len(entries))
    for tag, typ, value in entries:
        out += struct.pack("<HHI", tag, typ, 1) + _value(typ, value, big)
    return out + struct.pack("<I", next_offset)


def build_tiff(images, layout="cog", ghost=None, big=False):
    """Build a little-endian TIFF. Each image is (width, height, tiled, subfile)."""
    header_size = 16 if big else 8
    ghost_bytes = b""
    if ghost is not None:
        ghost_bytes = b"GDAL_STRUCTURAL_METADATA_SIZE=%06d bytes\n" % len(ghost) + ghost
    ifd_size = (8 + 7 * 20 + 8) if big else (2 + 7 * 12 + 4)
    start = header_size + len(ghost_bytes)
    n = len(images)
    if layout == "cog":
        ifds = [start + i * ifd_size for i in range(n)]
        data = [start + n * ifd_size + i * _BLOCK for i in range(n)]
    elif layout == "data_first":
        data = [start + i * _BLOCK for i in range(n)]
        ifds = [start + n * _BLOCK + i * ifd_size for i in range(n)]
    elif layout == "overviews_after_data":
        data = [start + ifd_size + i * _BLOCK for i in range(n)]
        ifds = [start] + [start + ifd_size + n * _BLOCK + (i - 1) * ifd_size for i in range(1, n)]
    else:
        raise ValueError(layout)
    buf = bytearray(max(ifds + data) + max(ifd_size, _BLOCK))
    if big:
        buf[0:16] = b"II" + struct.pack("<HHHQ", 43, 8, 0, ifds[0])
    else:
        buf[0:8] = b"II" + struct.pack("<HI", 42, ifds[0])
    buf[header_size:start] = ghost_bytes
    for i, (width, height, tiled, subfile) in enumerate(images):
        entries = [(254, 4, subfile), (256, 4, width), (257, 4, height)]
        if tiled:
            entries += [(322, 3, 256), (323, 3, 256), (324, 16 if big else 4, data[i]), (325, 4, _BLOCK)]
        else:
            entries += [(273, 4, data[i]), (277, 3, 1), (278, 4, height), (279, 4, _BLOCK)]
        nxt = ifds[i + 1] if i + 1 < n else 0
        raw = _ifd(entries, nxt, big)
        buf[ifds[i]:ifds[i] + len(raw)] = raw
    return bytes(buf)


def reader(blob, calls=None):
    def read(offset, length):
        if calls is not None:
            calls.append((offset, length))
        return blob[offset:offset + length]

    return read


MAIN = (4000, 3000, True, 0)
OVERVIEW = (2000, 1500, True, 1)
GHOST = (
    b"LAYOUT=IFDS_BEFORE_DATA\nBLOCK_ORDER=ROW_MAJOR\n"
    b"BLOCK_LEADER=SIZE_AS_UINT4\nBLOCK_TRAILER=LAST_4_BYTES_REPEATED\n"
    b"KNOWN_INCOMPATIBLE_EDITION=NO\n "
)


@pytest.mark.parametrize("big", [False, True])
def test_tiled_tiff_with_overviews_before_data_is_cog(big):
    assert is_cog_layout(reader(build_tiff([MAIN, OVERVIEW], big=big))) is True


def test_gdal_ghost_header_is_accepted():
    assert is_cog_layout(reader(build_tiff([MAIN, OVERVIEW], ghost=GHOST))) is True


def test_known_incompatible_edition_is_not_cog():
    edited = GHOST.replace(b"EDITION=NO", b"EDITION=YES")
    assert is_cog_layout(reader(build_tiff([MAIN, OVERVIEW], ghost=edited))) is False


def test_large_striped_tiff_is_not_cog():
    assert is_cog_layout(reader(build_tiff([(4000, 3000, False, 0)]))) is False


def test_large_tiled_tiff_without_overviews_is_not_cog():
    assert is_cog_layout(reader(build_tiff([MAIN]))) is False


def test_directories_after_pixel_data_are_not_cog():
    assert is_cog_layout(reader(build_tiff([MAIN, OVERVIEW], layout="data_first"))) is False


def test_overviews_appended_after_data_are_not_cog():
    blob = build_tiff([MAIN, OVERVIEW], layout="overviews_after_data")
    assert is_cog_layout(reader(blob)) is False


def test_small_striped_image_needs_no_tiles_or_overviews():
    assert is_cog_layout(reader(build_tiff([(400, 300, False, 0)]))) is True


@pytest.mark.parametrize("blob", [b"", b"not a tiff at all", b"II*\0" + b"\xff" * 4])
def test_garbage_is_not_cog(blob):
    assert is_cog_layout(reader(blob)) is False


def test_header_check_reads_only_the_start_of_the_file():
    calls = []
    blob = build_tiff([MAIN, OVERVIEW]) + b"\0" * (5 * 1024 * 1024)
    assert is_cog_layout(reader(blob, calls)) is True
    assert calls == [(0, 64 * 1024)]


@pytest.fixture
def s3(monkeypatch):
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        client = boto3.client("s3", region_name="ap-south-1")
        client.create_bucket(
            Bucket="test-bucket",
            CreateBucketConfiguration={"LocationConstraint": "ap-south-1"},
        )
        yield client


def test_s3_object_check_uses_ranged_reads(s3):
    s3.put_object(Bucket="test-bucket", Key="u/cog.tif", Body=build_tiff([MAIN, OVERVIEW]))
    s3.put_object(Bucket="test-bucket", Key="u/plain.tif", Body=build_tiff([(4000, 3000, False, 0)]))
    assert is_s3_object_cog(s3, "test-bucket", "u/cog.tif") is True
    assert is_s3_object_cog(s3, "test-bucket", "u/plain.tif") is False


def test_s3_errors_count_as_not_cog(s3):
    assert is_s3_object_cog(s3, "test-bucket", "u/missing.tif") is False


def test_inspect_reads_grid_and_epsg_from_real_geotiffs():
    from pathlib import Path

    from services.cog_check import inspect_tiff

    base = Path(__file__).parent / "fixtures" / "rasters"

    def inspect(name):
        blob = (base / name).read_bytes()
        return inspect_tiff(lambda offset, length: blob[offset:offset + length])

    wgs84 = inspect("cog_wgs84.tif")
    assert wgs84.is_cog and wgs84.epsg == 4326
    assert wgs84.geotransform == (77.0, 0.001, 0.0, 13.0, 0.0, -0.001)
    assert (wgs84.width, wgs84.height) == (600, 600)
    assert inspect("cog_utm43.tif").epsg == 32643
    assert inspect("cog_no_crs_metres.tif").epsg is None
    striped = inspect("striped_wgs84.tif")
    assert not striped.is_cog and striped.epsg == 4326
