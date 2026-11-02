"""Detect Cloud Optimized GeoTIFFs from the start of the file.

Only the TIFF header and image directories are read, through ranged reads,
so a multi-GB raster never has to be downloaded to answer the question.
The rules follow GDAL's ``validate_cloud_optimized_geotiff``: the main image
is tiled, large images carry overviews, and every image directory sits
before the pixel data.
"""

from __future__ import annotations

import logging
import re
import struct
from dataclasses import dataclass
from typing import Callable, Optional

logger = logging.getLogger(__name__)

HEADER_READ_BYTES = 64 * 1024
# GDAL does not require overviews or tiling below this size.
SMALL_IMAGE_PIXELS = 512
_MAX_IFDS = 64

_TAG_NEW_SUBFILE_TYPE = 254
_TAG_IMAGE_WIDTH = 256
_TAG_IMAGE_LENGTH = 257
_TAG_STRIP_OFFSETS = 273
_TAG_TILE_WIDTH = 322
_TAG_TILE_OFFSETS = 324

_TYPE_SIZES = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8,
               11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8}
_UNSIGNED = {1: "B", 3: "H", 4: "I", 13: "I", 16: "Q", 18: "Q"}

_GHOST_RE = re.compile(rb"GDAL_STRUCTURAL_METADATA_SIZE=(\d{6}) bytes\n")

# (offset, length) -> bytes. May return fewer bytes at end of file.
RangeReader = Callable[[int, int], bytes]


class _Source:
    def __init__(self, read: RangeReader):
        self._read = read
        self.head = read(0, HEADER_READ_BYTES)

    def read(self, offset: int, length: int) -> bytes:
        end = offset + length
        if end <= len(self.head):
            return self.head[offset:end]
        data = self._read(offset, length)
        if len(data) < length:
            raise ValueError("TIFF structure points past the end of the file")
        return data


class _Tiff:
    def __init__(self, src: _Source):
        head = src.head
        if head[:2] == b"II":
            self.bo = "<"
        elif head[:2] == b"MM":
            self.bo = ">"
        else:
            raise ValueError("Not a TIFF file")
        version = struct.unpack(self.bo + "H", head[2:4])[0]
        if version == 42:
            self.big = False
            self.header_size = 8
            self.first_ifd = struct.unpack(self.bo + "I", head[4:8])[0]
        elif version == 43:
            self.big = True
            self.header_size = 16
            self.first_ifd = struct.unpack(self.bo + "Q", head[8:16])[0]
        else:
            raise ValueError("Not a TIFF file")
        self.src = src

    def ifd(self, offset: int) -> tuple[dict[int, tuple[int, int, bytes]], int]:
        """Return ({tag: (type, count, inline_bytes)}, next_ifd_offset)."""
        if self.big:
            count = struct.unpack(self.bo + "Q", self.src.read(offset, 8))[0]
            entry_size, inline, start = 20, 8, offset + 8
        else:
            count = struct.unpack(self.bo + "H", self.src.read(offset, 2))[0]
            entry_size, inline, start = 12, 4, offset + 2
        if count == 0 or count > 4096:
            raise ValueError("Implausible TIFF directory")
        raw = self.src.read(start, count * entry_size + inline)
        entries: dict[int, tuple[int, int, bytes]] = {}
        for i in range(count):
            e = raw[i * entry_size:(i + 1) * entry_size]
            if self.big:
                tag, typ, n = struct.unpack(self.bo + "HHQ", e[:12])
                value = e[12:20]
            else:
                tag, typ, n = struct.unpack(self.bo + "HHI", e[:8])
                value = e[8:12]
            entries[tag] = (typ, n, value)
        next_raw = raw[count * entry_size:count * entry_size + inline]
        nxt = struct.unpack(self.bo + ("Q" if self.big else "I"), next_raw)[0]
        return entries, nxt

    def first_value(self, entry: Optional[tuple[int, int, bytes]]) -> Optional[int]:
        if entry is None:
            return None
        typ, n, value = entry
        fmt = _UNSIGNED.get(typ)
        size = _TYPE_SIZES.get(typ)
        if fmt is None or size is None or n < 1:
            return None
        inline = 8 if self.big else 4
        if n * size <= inline:
            data = value[:size]
        else:
            ptr = struct.unpack(self.bo + ("Q" if self.big else "I"), value)[0]
            data = self.src.read(ptr, size)
        return struct.unpack(self.bo + fmt, data)[0]


def _ghost_layout(tiff: _Tiff) -> tuple[int, Optional[bytes]]:
    """Return (expected main IFD offset, ghost metadata or None)."""
    head = tiff.src.head
    match = _GHOST_RE.match(head, tiff.header_size)
    if not match:
        return tiff.header_size, None
    size = int(match.group(1))
    body = head[match.end():match.end() + size]
    return match.end() + size, body


def is_cog_layout(read: RangeReader) -> bool:
    """True when the TIFF behind ``read`` is laid out as a Cloud Optimized GeoTIFF."""
    try:
        tiff = _Tiff(_Source(read))
        expected_ifd, ghost = _ghost_layout(tiff)
        if ghost is not None and b"KNOWN_INCOMPATIBLE_EDITION=YES" in ghost:
            return False
        # The directory may be padded to a word boundary.
        if not expected_ifd <= tiff.first_ifd <= expected_ifd + 1:
            return False

        main, nxt = tiff.ifd(tiff.first_ifd)
        width = tiff.first_value(main.get(_TAG_IMAGE_WIDTH)) or 0
        height = tiff.first_value(main.get(_TAG_IMAGE_LENGTH)) or 0
        small = width <= SMALL_IMAGE_PIXELS and height <= SMALL_IMAGE_PIXELS
        tiled = _TAG_TILE_WIDTH in main
        if not tiled and not small:
            return False
        data_start = tiff.first_value(
            main.get(_TAG_TILE_OFFSETS) or main.get(_TAG_STRIP_OFFSETS)
        )
        if data_start is None or data_start <= tiff.first_ifd:
            return False

        overviews = 0
        last_ifd = tiff.first_ifd
        seen = 0
        while nxt and seen < _MAX_IFDS:
            seen += 1
            if nxt <= last_ifd or nxt >= data_start:
                return False
            entries, following = tiff.ifd(nxt)
            subfile = tiff.first_value(entries.get(_TAG_NEW_SUBFILE_TYPE)) or 0
            if subfile & 1:
                overviews += 1
            last_ifd, nxt = nxt, following
        if not small and overviews == 0:
            return False
        return True
    except (ValueError, struct.error) as exc:
        logger.info("Not a COG layout: %s", exc)
        return False


_TAG_MODEL_PIXEL_SCALE = 33550
_TAG_MODEL_TIEPOINT = 33922
_TAG_MODEL_TRANSFORMATION = 34264
_TAG_GEO_KEY_DIRECTORY = 34735
_KEY_MODEL_TYPE = 1024
_KEY_GEOGRAPHIC_TYPE = 2048
_KEY_PROJECTED_TYPE = 3072
_USER_DEFINED = 32767
_FLOAT = {11: "f", 12: "d"}


def _values(tiff: _Tiff, entry: Optional[tuple[int, int, bytes]], limit: int = 4096) -> list:
    """All values of a numeric tag (short, long, float, or double)."""
    if entry is None:
        return []
    typ, n, value = entry
    fmt = _UNSIGNED.get(typ) or _FLOAT.get(typ)
    size = _TYPE_SIZES.get(typ)
    if fmt is None or size is None or n < 1 or n > limit:
        return []
    total = n * size
    inline = 8 if tiff.big else 4
    if total <= inline:
        data = value[:total]
    else:
        ptr = struct.unpack(tiff.bo + ("Q" if tiff.big else "I"), value)[0]
        data = tiff.src.read(ptr, total)
    return list(struct.unpack(tiff.bo + fmt * n, data))


@dataclass(frozen=True)
class TiffInspection:
    """What the first bytes of a GeoTIFF say, without GDAL."""

    is_cog: bool
    width: int = 0
    height: int = 0
    geotransform: Optional[tuple[float, ...]] = None
    # EPSG code from the GeoKeys. None when absent or user-defined.
    epsg: Optional[int] = None
    # True when GeoKeys exist but describe a user-defined CRS that only
    # GDAL can read fully.
    custom_crs: bool = False


def _memo(read: RangeReader) -> RangeReader:
    cache: dict[tuple[int, int], bytes] = {}

    def cached(offset: int, length: int) -> bytes:
        key = (offset, length)
        if key not in cache:
            cache[key] = read(offset, length)
        return cache[key]

    return cached


def inspect_tiff(read: RangeReader) -> TiffInspection:
    """COG layout plus grid and EPSG code, from ranged reads only."""
    read = _memo(read)
    is_cog = is_cog_layout(read)
    try:
        tiff = _Tiff(_Source(read))
        main, _next = tiff.ifd(tiff.first_ifd)
        width = tiff.first_value(main.get(_TAG_IMAGE_WIDTH)) or 0
        height = tiff.first_value(main.get(_TAG_IMAGE_LENGTH)) or 0

        geotransform = None
        matrix = _values(tiff, main.get(_TAG_MODEL_TRANSFORMATION))
        scale = _values(tiff, main.get(_TAG_MODEL_PIXEL_SCALE))
        ties = _values(tiff, main.get(_TAG_MODEL_TIEPOINT))
        if len(matrix) >= 8:
            geotransform = (matrix[3], matrix[0], matrix[1], matrix[7], matrix[4], matrix[5])
        elif len(scale) >= 2 and len(ties) == 6:
            # One tie point plus a pixel size defines a north-up grid.
            i, j, _k, x, y, _z = ties
            geotransform = (x - i * scale[0], scale[0], 0.0, y + j * scale[1], 0.0, -scale[1])

        keys = _values(tiff, main.get(_TAG_GEO_KEY_DIRECTORY))
        directory: dict[int, int] = {}
        if len(keys) >= 4:
            count = keys[3]
            for n in range(count):
                base = 4 + n * 4
                if base + 3 >= len(keys):
                    break
                key_id, location, _count, value = keys[base:base + 4]
                if location == 0:
                    directory[key_id] = value
        code = directory.get(_KEY_PROJECTED_TYPE) or directory.get(_KEY_GEOGRAPHIC_TYPE)
        epsg = code if code and code != _USER_DEFINED else None
        custom = bool(directory) and epsg is None
        return TiffInspection(is_cog, width, height, geotransform, epsg, custom)
    except (ValueError, struct.error) as exc:
        logger.info("Could not read GeoTIFF tags: %s", exc)
        return TiffInspection(is_cog)


def s3_range_reader(client, bucket: str, key: str) -> RangeReader:
    def read(offset: int, length: int) -> bytes:
        resp = client.get_object(
            Bucket=bucket, Key=key, Range=f"bytes={offset}-{offset + length - 1}"
        )
        body = resp["Body"]
        try:
            return body.read()
        finally:
            body.close()

    return read


def is_s3_object_cog(client, bucket: str, key: str) -> bool:
    """Check an S3 object with a few ranged reads. Errors count as "not a COG"."""
    try:
        return is_cog_layout(s3_range_reader(client, bucket, key))
    except Exception:
        logger.exception("COG check failed for s3://%s/%s", bucket, key)
        return False


def inspect_s3_tiff(client, bucket: str, key: str) -> TiffInspection:
    """Like ``inspect_tiff`` for an S3 object. Errors count as "not a COG"."""
    try:
        return inspect_tiff(s3_range_reader(client, bucket, key))
    except Exception:
        logger.exception("TIFF inspection failed for s3://%s/%s", bucket, key)
        return TiffInspection(False)
