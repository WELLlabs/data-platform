"""Classify native file formats into viewers and conversion targets."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

VIEWER_DOCUMENT = "document"
VIEWER_TABLE_CHART = "table_chart"
VIEWER_VECTOR_MAP = "vector_map"
VIEWER_RASTER_MAP = "raster_map"

STATUS_PROCESSING = "processing"
STATUS_AVAILABLE = "available"
STATUS_REMOVED = "removed"

VECTOR_FEATURE_LIMIT = 100_000


@dataclass(frozen=True)
class FormatPlan:
    viewer: str
    cloud_native: bool
    target_format: str
    conversion: str  # none | pdf | parquet | vector | cog


def _ext_from_name(name: Optional[str]) -> str:
    if not name:
        return ""
    base = name.split("?")[0].split("#")[0]
    if "." not in base:
        return ""
    return base.rsplit(".", 1)[-1].lower().strip()


def normalize_format_token(file_format: Optional[str], file_key: Optional[str] = None) -> str:
    ext = _ext_from_name(file_key)
    raw = (file_format or "").lower().strip()
    blob = f"{raw} {ext}"

    if "pmtiles" in blob or ext == "pmtiles":
        return "pmtiles"
    if "flatgeobuf" in blob or ext in {"fgb", "flatgeobuf"}:
        return "flatgeobuf"
    if "geoparquet" in blob or ext == "geoparquet":
        return "geoparquet"
    if "geojson" in blob or ext == "geojson":
        return "geojson"
    if "gpkg" in blob or "geopackage" in blob or ext == "gpkg":
        return "geopackage"
    if "cog" in blob:
        return "cog"
    if "geotiff" in blob or ext in {"tif", "tiff"}:
        return "geotiff"
    if "parquet" in blob or ext == "parquet":
        return "parquet"
    if "pdf" in blob or ext == "pdf":
        return "pdf"
    if ext in {"docx", "doc"} or "wordprocessingml" in blob or raw == "doc" or raw == "docx":
        return ext or "docx"
    if ext in {"pptx", "ppt"} or "presentationml" in blob:
        return ext or "pptx"
    if ext in {"xlsx", "xls"} or "spreadsheetml" in blob or "excel" in blob:
        return ext or "xlsx"
    if ext in {"csv", "tsv"} or "csv" in blob or "tsv" in blob:
        return ext or "csv"
    if ext in {"html", "htm"} or "html" in blob:
        return "html"
    if ext == "xml" or raw == "xml":
        return "xml"
    if ext in {"md", "markdown"} or "markdown" in blob:
        return "markdown"
    if ext == "txt" or "text/plain" in blob or raw == "txt":
        return "txt"
    if ext:
        return ext
    return raw.split("/")[-1] if raw else ""


def plan_for_format(file_format: Optional[str], file_key: Optional[str] = None) -> Optional[FormatPlan]:
    token = normalize_format_token(file_format, file_key)
    if not token:
        return None

    if token == "pdf":
        return FormatPlan(VIEWER_DOCUMENT, True, "pdf", "none")
    if token in {"docx", "doc", "pptx", "ppt", "html", "xml", "txt", "markdown", "md"}:
        return FormatPlan(VIEWER_DOCUMENT, False, "pdf", "pdf")
    if token in {"csv", "tsv", "xlsx", "xls"}:
        return FormatPlan(VIEWER_TABLE_CHART, False, "parquet", "parquet")
    if token == "parquet":
        return FormatPlan(VIEWER_TABLE_CHART, True, "parquet", "none")
    if token in {"geojson", "geopackage", "geoparquet"}:
        return FormatPlan(VIEWER_VECTOR_MAP, False, "flatgeobuf", "vector")
    if token == "flatgeobuf":
        return FormatPlan(VIEWER_VECTOR_MAP, True, "flatgeobuf", "none")
    if token == "pmtiles":
        return FormatPlan(VIEWER_VECTOR_MAP, True, "pmtiles", "none")
    if token == "cog":
        return FormatPlan(VIEWER_RASTER_MAP, True, "cog", "none")
    if token == "geotiff":
        return FormatPlan(VIEWER_RASTER_MAP, False, "cog", "cog")
    return None


def mime_for_cloud_format(fmt: str) -> str:
    mapping = {
        "pdf": "application/pdf",
        "parquet": "application/vnd.apache.parquet",
        "flatgeobuf": "application/octet-stream",
        "pmtiles": "application/vnd.pmtiles",
        "cog": "image/tiff",
    }
    return mapping.get((fmt or "").lower(), "application/octet-stream")
