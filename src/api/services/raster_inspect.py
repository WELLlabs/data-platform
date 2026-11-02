"""Read a raster's georeferencing with GDAL and decide how to preview it.

Runs on the conversion worker, which has the GDAL command-line tools. The
API has no GDAL; it uses ``cog_check.inspect_tiff`` for its fast path and
hands anything uncertain to the worker.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from dataclasses import dataclass
from typing import Any, Callable, Optional

from services.raster_georef import (
    GEOREF_OK,
    GEOREF_UNPLACEABLE,
    GeorefDecision,
    RasterGeoref,
    assess,
)

logger = logging.getLogger(__name__)

# GDAL settings for reading a presigned S3 URL by ranged GETs.
# A presigned GET URL rejects HEAD requests, and listing the "directory"
# would issue extra requests that are always refused.
GDAL_HTTP_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_USE_HEAD": "NO",
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "1",
    "GDAL_HTTP_TIMEOUT": "60",
}


@dataclass(frozen=True)
class RasterPlan:
    decision: GeorefDecision
    # True: serve the uploaded file as it is. False: write a COG derivative.
    reuse_native: bool


def gdalinfo_json(source: str, run: Callable[..., Any], timeout: int = 120) -> dict:
    """``gdalinfo -json`` for a local path or a ``/vsicurl/`` URL.

    Only the header is read. Colour tables are skipped (-noct): the
    colour interpretation already says whether the band is paletted.
    """
    exe = shutil.which("gdalinfo")
    if not exe:
        raise FileNotFoundError("gdalinfo")
    env = {**os.environ, **GDAL_HTTP_ENV}
    proc = run([exe, "-json", "-noct", "-nofl", source], timeout=timeout, env=env)
    return json.loads(proc.stdout or "{}")


def georef_from_gdalinfo(doc: dict) -> RasterGeoref:
    size = doc.get("size") or [0, 0]
    width, height = (int(size[0]), int(size[1])) if len(size) == 2 else (0, 0)
    geotransform = doc.get("geoTransform")
    if not (isinstance(geotransform, list) and len(geotransform) == 6):
        geotransform = None
    wkt = ((doc.get("coordinateSystem") or {}).get("wkt") or "").strip() or None
    gcps = (doc.get("gcps") or {}).get("gcpList") or []
    return RasterGeoref(width, height, geotransform, wkt, has_gcps=bool(gcps))


def layout_is_cog(doc: dict) -> bool:
    structure = (doc.get("metadata") or {}).get("IMAGE_STRUCTURE") or {}
    return str(structure.get("LAYOUT", "")).upper() == "COG"


def plan_raster(
    doc: dict,
    structural_cog: Callable[[], bool],
    candidates: list[str],
    region: tuple[float, float, float, float],
) -> RasterPlan:
    """Decide between serving the upload as is and writing a derivative.

    * Unplaceable: serve as is. The preview explains why there is no map and
      the download is unaffected, so a rewrite would be wasted work.
    * Wrong or missing CRS, or GCPs only: write a derivative with the fix.
    * Sound georeferencing: serve as is when it is already a COG (GDAL's
      LAYOUT=COG tag, or the same structure written by another tool),
      otherwise convert.
    """
    decision = assess(georef_from_gdalinfo(doc), candidates, region)
    if decision.status == GEOREF_UNPLACEABLE:
        return RasterPlan(decision, reuse_native=True)
    if decision.needs_rewrite:
        return RasterPlan(decision, reuse_native=False)
    is_cog = layout_is_cog(doc) or structural_cog()
    return RasterPlan(decision, reuse_native=is_cog)


def verify_output(
    doc: dict,
    expected: GeorefDecision,
    candidates: list[str],
    region: tuple[float, float, float, float],
) -> GeorefDecision:
    """Check a written derivative. The fix must leave it sound."""
    after = assess(georef_from_gdalinfo(doc), candidates, region)
    if after.status == GEOREF_OK:
        # Keep the explanation of what was assumed for the viewer.
        return expected if expected.status != GEOREF_OK else after
    logger.warning("Derivative still not placeable: %s", after.note)
    return GeorefDecision(
        status=GEOREF_UNPLACEABLE,
        note=after.note or expected.note,
    )
