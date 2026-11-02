"""Decide whether a raster can be placed on a web map, and how to fix it if not.

A GeoTIFF needs two things to land in the right place: a geotransform
(pixel -> coordinate) and a coordinate reference system (CRS) that says what
those coordinates mean. Uploads get either one wrong in a few common ways:

* The CRS is missing (the ``.prj`` sidecar was not uploaded).
* The CRS says degrees but the coordinates are metres. National products
  such as NRSC/Bhuvan LULC 250K are often exported this way; their
  coordinates are really in the India NSF Lambert Conformal Conic
  projection (EPSG:7755).
* The CRS says metres but the coordinates are degrees.
* There is no geotransform, only ground control points (GCPs).
* There is no location information at all.

``assess`` turns what the file says into one decision. When the true CRS is
guessed, it is guessed only if exactly one candidate puts the data inside the
expected region, so an ambiguous file (for example a UTM file without a zone)
is reported instead of being drawn in the wrong place.

This module only does arithmetic with pyproj, so the API, the conversion
worker, and the tests all share it.
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Optional, Sequence

logger = logging.getLogger(__name__)

GEOREF_OK = "ok"
GEOREF_ASSUMED = "assumed"
GEOREF_UNPLACEABLE = "unplaceable"

# Longitudes up to 360 appear in global climate grids (0-360 convention).
_LON_MIN, _LON_MAX = -180.5, 360.5
_LAT_MIN, _LAT_MAX = -90.5, 90.5
# Share of the reprojected footprint that must fall inside the region.
_REGION_FIT = 0.9
_EDGE_POINTS = 21


@dataclass(frozen=True)
class RasterGeoref:
    """What a file says about its location, as read by GDAL or from TIFF tags."""

    width: int
    height: int
    # GDAL order: (x0, pixel_w, row_rot, y0, col_rot, pixel_h). None if absent.
    geotransform: Optional[Sequence[float]]
    # Anything pyproj.CRS.from_user_input accepts (WKT, "EPSG:4326"). None if absent.
    crs: Optional[str]
    has_gcps: bool = False


@dataclass(frozen=True)
class GeorefDecision:
    status: str  # ok | assumed | unplaceable
    # CRS to stamp on the derivative (gdal_translate -a_srs). None keeps the file's.
    assign_crs: Optional[str] = None
    # True when the derivative must be warped from GCPs (gdalwarp).
    warp_gcps: bool = False
    # Plain-language explanation for the viewer. Empty when nothing is wrong.
    note: str = ""
    # (west, south, east, north) in degrees when known.
    wgs84_bounds: Optional[tuple[float, float, float, float]] = None
    candidates_tried: tuple[str, ...] = field(default_factory=tuple)

    @property
    def needs_rewrite(self) -> bool:
        return self.assign_crs is not None or self.warp_gcps


def native_bounds(
    geotransform: Sequence[float], width: int, height: int
) -> Optional[tuple[float, float, float, float]]:
    """(minx, miny, maxx, maxy) of the raster in its own coordinates.

    All four corners are used, so rotated or flipped grids are handled.
    """
    if not geotransform or len(geotransform) != 6 or width <= 0 or height <= 0:
        return None
    x0, a, b, y0, d, e = (float(v) for v in geotransform)
    if not all(math.isfinite(v) for v in (x0, a, b, y0, d, e)):
        return None
    if a == 0 and b == 0 or d == 0 and e == 0:
        return None
    xs, ys = [], []
    for col, row in ((0, 0), (width, 0), (0, height), (width, height)):
        xs.append(x0 + col * a + row * b)
        ys.append(y0 + col * d + row * e)
    return min(xs), min(ys), max(xs), max(ys)


def _looks_like_degrees(bounds: tuple[float, float, float, float]) -> bool:
    minx, miny, maxx, maxy = bounds
    return (
        _LON_MIN <= minx < maxx <= _LON_MAX
        and _LAT_MIN <= miny < maxy <= _LAT_MAX
    )


def _valid_lonlat(bounds: Optional[tuple[float, float, float, float]]) -> bool:
    if bounds is None:
        return False
    if not all(math.isfinite(v) for v in bounds):
        return False
    return _looks_like_degrees(bounds)


def _load_crs(value: Optional[str]):
    if not value:
        return None
    try:
        from pyproj import CRS

        return CRS.from_user_input(value)
    except Exception:
        logger.info("Unreadable CRS definition: %.120s", value)
        return None


def _crs_label(crs) -> str:
    try:
        epsg = crs.to_epsg(min_confidence=70)
    except Exception:
        epsg = None
    name = getattr(crs, "name", "") or "unnamed CRS"
    return f"{name} (EPSG:{epsg})" if epsg else name


def to_wgs84_bounds(
    crs_value, bounds: tuple[float, float, float, float]
) -> Optional[tuple[float, float, float, float]]:
    """Reproject a box to longitude/latitude, densifying the edges.

    Returns None when the transform fails or produces non-finite values,
    which is what happens when coordinates are far outside the projection's
    valid area.
    """
    crs = crs_value if hasattr(crs_value, "to_wkt") else _load_crs(crs_value)
    if crs is None:
        return None
    try:
        from pyproj import Transformer

        if crs.is_geographic:
            out = (bounds[0], bounds[1], bounds[2], bounds[3])
        else:
            transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
            out = transformer.transform_bounds(*bounds, densify_pts=_EDGE_POINTS)
    except Exception:
        return None
    out = tuple(float(v) for v in out)
    if not all(math.isfinite(v) for v in out):
        return None
    return out  # type: ignore[return-value]


def _overlap_share(
    box: tuple[float, float, float, float], region: tuple[float, float, float, float]
) -> float:
    w = max(0.0, min(box[2], region[2]) - max(box[0], region[0]))
    h = max(0.0, min(box[3], region[3]) - max(box[1], region[1]))
    area = (box[2] - box[0]) * (box[3] - box[1])
    return (w * h) / area if area > 0 else 0.0


def _fitting_candidates(
    bounds: tuple[float, float, float, float],
    candidates: Sequence[str],
    region: tuple[float, float, float, float],
) -> list[tuple[str, tuple[float, float, float, float]]]:
    fits = []
    for code in candidates:
        lonlat = to_wgs84_bounds(code, bounds)
        if not _valid_lonlat(lonlat):
            continue
        if _overlap_share(lonlat, region) >= _REGION_FIT:
            fits.append((code, lonlat))
    return fits


def _guess(
    bounds: tuple[float, float, float, float],
    candidates: Sequence[str],
    region: tuple[float, float, float, float],
    problem: str,
) -> GeorefDecision:
    tried = tuple(candidates)
    fits = _fitting_candidates(bounds, candidates, region)
    if len(fits) == 1:
        code, lonlat = fits[0]
        label = _crs_label(_load_crs(code))
        return GeorefDecision(
            status=GEOREF_ASSUMED,
            assign_crs=code,
            note=(
                f"{problem} The map assumes {label}, the only common projection "
                "that places the data in the expected region. Check the location "
                "before relying on it; the downloaded file is unchanged."
            ),
            wgs84_bounds=lonlat,
            candidates_tried=tried,
        )
    if fits:
        names = ", ".join(code for code, _ in fits)
        reason = f"Several projections fit ({names}), so the location cannot be chosen safely."
    else:
        reason = "None of the common projections places it in the expected region."
    return GeorefDecision(
        status=GEOREF_UNPLACEABLE,
        note=(
            f"{problem} {reason} Download the file to open it in GIS software, "
            "or re-upload it with the correct coordinate reference system."
        ),
        candidates_tried=tried,
    )


def assess(
    info: RasterGeoref,
    candidates: Sequence[str],
    region: tuple[float, float, float, float],
) -> GeorefDecision:
    """Return how the raster should be placed on the map."""
    bounds = native_bounds(info.geotransform, info.width, info.height) if info.geotransform else None

    if bounds is None:
        if info.has_gcps:
            return GeorefDecision(
                status=GEOREF_ASSUMED,
                warp_gcps=True,
                note=(
                    "The file is located by ground control points, not a regular grid. "
                    "The map shows a warped copy; the downloaded file is unchanged."
                ),
            )
        return GeorefDecision(
            status=GEOREF_UNPLACEABLE,
            note=(
                "The file has no location information (no coordinates or coordinate "
                "reference system), so it cannot be placed on the map. Download it to "
                "view it, or re-upload a georeferenced version."
            ),
        )

    crs = _load_crs(info.crs)

    if crs is None:
        if _looks_like_degrees(bounds):
            return GeorefDecision(
                status=GEOREF_ASSUMED,
                assign_crs="EPSG:4326",
                note=(
                    "The file has no coordinate reference system. Its coordinates look "
                    "like longitude and latitude, so the map assumes WGS 84 (EPSG:4326)."
                ),
                wgs84_bounds=bounds,
            )
        return _guess(
            bounds,
            candidates,
            region,
            "The file has no coordinate reference system and its coordinates are not "
            "longitude and latitude.",
        )

    if crs.is_geographic:
        if _looks_like_degrees(bounds):
            return GeorefDecision(status=GEOREF_OK, wgs84_bounds=bounds)
        return _guess(
            bounds,
            [c for c in candidates if not _is_geographic_code(c)],
            region,
            f"The file is labelled {_crs_label(crs)}, which uses degrees, but its "
            "coordinates are in metres.",
        )

    lonlat = to_wgs84_bounds(crs, bounds)
    # Degree values read as metres land within a few hundred metres of the
    # projection's origin, which still converts to a valid longitude and
    # latitude. A projected raster whose whole extent fits inside 360 x 180
    # units is almost always a degree grid with the wrong label.
    degrees_mislabelled = _looks_like_degrees(bounds) and (
        bounds[2] - bounds[0] <= 360 and bounds[3] - bounds[1] <= 180
    )
    if _valid_lonlat(lonlat) and not degrees_mislabelled:
        return GeorefDecision(status=GEOREF_OK, wgs84_bounds=lonlat)
    if degrees_mislabelled:
        return GeorefDecision(
            status=GEOREF_ASSUMED,
            assign_crs="EPSG:4326",
            note=(
                f"The file is labelled {_crs_label(crs)}, which uses metres, but its "
                "coordinates are longitude and latitude. The map assumes WGS 84 (EPSG:4326)."
            ),
            wgs84_bounds=bounds,
        )
    return GeorefDecision(
        status=GEOREF_UNPLACEABLE,
        note=(
            f"The file's coordinates cannot be converted from {_crs_label(crs)} to "
            "longitude and latitude. Download the file to open it in GIS software, "
            "or re-upload it with the correct coordinate reference system."
        ),
    )


def _is_geographic_code(code: str) -> bool:
    crs = _load_crs(code)
    return bool(crs is not None and crs.is_geographic)


def parse_region(value: str) -> tuple[float, float, float, float]:
    """Parse "west,south,east,north"; fall back to the whole world."""
    try:
        parts = tuple(float(v) for v in str(value).split(","))
        if len(parts) == 4 and parts[0] < parts[2] and parts[1] < parts[3]:
            return parts  # type: ignore[return-value]
    except ValueError:
        pass
    logger.warning("Invalid RASTER_EXPECTED_REGION %r; using the whole world", value)
    return (-180.0, -90.0, 180.0, 90.0)


def parse_candidates(value: str) -> list[str]:
    return [c.strip() for c in str(value or "").split(",") if c.strip()]
