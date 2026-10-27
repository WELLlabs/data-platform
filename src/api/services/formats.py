"""Classify native file formats into viewers and conversion targets."""

from __future__ import annotations

import mimetypes
from dataclasses import dataclass
from typing import Optional

VIEWER_DOCUMENT = "document"
VIEWER_TABLE_CHART = "table_chart"
VIEWER_VECTOR_MAP = "vector_map"
VIEWER_RASTER_MAP = "raster_map"
VIEWER_IMAGE = "image"
VIEWER_TEXT = "text"
VIEWER_MEDIA = "media"
VIEWER_EMBED = "embed"

STATUS_PROCESSING = "processing"
STATUS_AVAILABLE = "available"
STATUS_REMOVED = "removed"

VECTOR_FEATURE_LIMIT = 100_000

# Geospatial tokens. Supported ones are planned below; the rest stay unsupported.
_GEO_TOKENS = {
    "pmtiles",
    "mbtiles",
    "mvt",
    "flatgeobuf",
    "fgb",
    "geoparquet",
    "geojson",
    "geopackage",
    "gpkg",
    "cog",
    "geotiff",
    "tif",
    "tiff",
    "shp",
    "shx",
    "dbf",
    "prj",
    "cpg",
    "kml",
    "kmz",
    "gml",
    "topojson",
    "wkt",
}

# Excel workbooks are converted to Parquet and shown as a table and chart.
_EXCEL_TOKENS = {"xlsx", "xls", "xlsm", "xlsb", "xlt", "xltx", "xltm"}
_SUPPORTED_GEO = {
    "pmtiles",
    "flatgeobuf",
    "fgb",
    "geoparquet",
    "geojson",
    "geopackage",
    "gpkg",
    "cog",
    "geotiff",
    "tif",
    "tiff",
}

_PDF_CONVERT = {
    "docx",
    "doc",
    "pptx",
    "ppt",
    "html",
    "htm",
    "xml",
    "txt",
    "markdown",
    "md",
    "rtf",
    "odt",
    "odp",
    "ods",
    "fodt",
    "fodp",
}

_IMAGE_TOKENS = {"png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"}
_AUDIO_TOKENS = {"mp3", "wav", "ogg", "m4a", "aac", "flac"}
_VIDEO_TOKENS = {"mp4", "webm", "mov", "m4v", "ogv"}
_TEXT_TOKENS = {
    "json",
    "ndjson",
    "yaml",
    "yml",
    "log",
    "ini",
    "cfg",
    "conf",
    "toml",
    "sql",
    "py",
    "js",
    "ts",
    "tsx",
    "jsx",
    "css",
    "rst",
    "tex",
}


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
    if "geojson" in blob or "geo+json" in blob or ext == "geojson":
        return "geojson"
    if "gpkg" in blob or "geopackage" in blob or ext == "gpkg":
        return "geopackage"
    if (
        ext in {"kml", "kmz", "shp", "shx", "prj", "cpg", "gml", "topojson"}
        or "shapefile" in blob
        or "kml" in blob
        or "kmz" in blob
        or raw in {"kml", "kmz", "shp", "gml", "topojson"}
    ):
        return ext if ext in _GEO_TOKENS else "shp"
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
    if ext in _EXCEL_TOKENS or raw in _EXCEL_TOKENS or "spreadsheetml" in blob or "excel" in blob:
        if ext in _EXCEL_TOKENS:
            return ext
        if raw in _EXCEL_TOKENS:
            return raw
        return "xlsx"
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


def _excluded_from_visualization(token: str) -> bool:
    if token in _SUPPORTED_GEO or token in _EXCEL_TOKENS:
        return False
    if token in _GEO_TOKENS:
        return True
    if token.startswith("geo"):
        return True
    return False


def plan_for_format(file_format: Optional[str], file_key: Optional[str] = None) -> Optional[FormatPlan]:
    """Viewer plan for a file.

    Shapefile and KML are not visualised. Excel workbooks are.
    """
    token = normalize_format_token(file_format, file_key)
    if token and _excluded_from_visualization(token):
        return None
    if not token:
        return FormatPlan(VIEWER_EMBED, True, "bin", "none")

    if token == "pdf":
        return FormatPlan(VIEWER_DOCUMENT, True, "pdf", "none")
    if token in _PDF_CONVERT:
        return FormatPlan(VIEWER_DOCUMENT, False, "pdf", "pdf")
    if token in {"csv", "tsv"} or token in _EXCEL_TOKENS:
        return FormatPlan(VIEWER_TABLE_CHART, False, "parquet", "parquet")
    if token == "parquet":
        return FormatPlan(VIEWER_TABLE_CHART, True, "parquet", "none")
    if token in {"geojson", "geopackage", "geoparquet"}:
        return FormatPlan(VIEWER_VECTOR_MAP, False, "flatgeobuf", "vector")
    if token in {"flatgeobuf", "pmtiles"}:
        return FormatPlan(VIEWER_VECTOR_MAP, True, token, "none")
    if token == "cog":
        return FormatPlan(VIEWER_RASTER_MAP, True, "cog", "none")
    if token == "geotiff":
        return FormatPlan(VIEWER_RASTER_MAP, False, "cog", "cog")
    if token in _IMAGE_TOKENS:
        return FormatPlan(VIEWER_IMAGE, True, token, "none")
    if token in _AUDIO_TOKENS or token in _VIDEO_TOKENS:
        return FormatPlan(VIEWER_MEDIA, True, token, "none")
    if token in _TEXT_TOKENS:
        return FormatPlan(VIEWER_TEXT, True, token, "none")
    return FormatPlan(VIEWER_EMBED, True, token, "none")


def mime_for_cloud_format(fmt: str) -> str:
    mapping = {
        "pdf": "application/pdf",
        "parquet": "application/vnd.apache.parquet",
        "flatgeobuf": "application/octet-stream",
        "pmtiles": "application/vnd.pmtiles",
        "cog": "image/tiff",
        "jpg": "image/jpeg",
        "svg": "image/svg+xml",
        "md": "text/plain",
        "markdown": "text/plain",
        "json": "application/json",
        "txt": "text/plain",
    }
    key = (fmt or "").lower()
    if key in mapping:
        return mapping[key]
    guessed, _ = mimetypes.guess_type(f"file.{key}")
    if guessed:
        return guessed
    return "application/octet-stream"
