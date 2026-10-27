from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from services.formats import plan_for_format
from services.visualization import (
    CONVERSION_TASK_TIME_LIMIT,
    VisualizationService,
    quote_ident,
)


def test_document_and_table_plans():
    docx = plan_for_format("docx")
    assert docx is not None
    assert docx.target_format == "pdf"
    assert docx.conversion == "pdf"
    csv = plan_for_format("csv")
    assert csv is not None
    assert csv.target_format == "parquet"
    xlsx = plan_for_format("xlsx")
    assert xlsx is not None
    assert xlsx.viewer == "table_chart"
    assert xlsx.target_format == "parquet"
    assert xlsx.conversion == "parquet"
    assert xlsx.cloud_native is False
    for token in ("xls", "xlsm", "xlsb", "xlt", "xltx", "xltm"):
        excel = plan_for_format(token, f"costs.{token}")
        assert excel is not None
        assert excel.viewer == "table_chart"
        assert excel.target_format == "parquet"
        assert excel.conversion == "parquet"
        assert excel.cloud_native is False


def test_vector_and_raster_plans():
    geojson = plan_for_format("geojson")
    assert geojson is not None
    assert geojson.viewer == "vector_map"
    assert geojson.conversion == "vector"
    assert geojson.cloud_native is False

    gpkg = plan_for_format("gpkg", "layer.gpkg")
    assert gpkg is not None
    assert gpkg.viewer == "vector_map"
    assert gpkg.conversion == "vector"

    geoparquet = plan_for_format("geoparquet")
    assert geoparquet is not None
    assert geoparquet.conversion == "vector"

    flat = plan_for_format("flatgeobuf", "roads.fgb")
    assert flat is not None
    assert flat.viewer == "vector_map"
    assert flat.cloud_native is True
    assert flat.conversion == "none"
    assert flat.target_format == "flatgeobuf"

    pmtiles = plan_for_format("pmtiles")
    assert pmtiles is not None
    assert pmtiles.viewer == "vector_map"
    assert pmtiles.cloud_native is True
    assert pmtiles.conversion == "none"
    assert pmtiles.target_format == "pmtiles"

    geotiff = plan_for_format("geotiff", "scene.tif")
    assert geotiff is not None
    assert geotiff.viewer == "raster_map"
    assert geotiff.conversion == "cog"
    assert geotiff.cloud_native is False
    assert geotiff.target_format == "cog"

    cog = plan_for_format("cog", "scene.tif")
    assert cog is not None
    assert cog.viewer == "raster_map"
    assert cog.cloud_native is True
    assert cog.conversion == "none"
    assert cog.target_format == "cog"

    assert plan_for_format("shp") is None
    assert plan_for_format("kml") is None


def test_quote_ident_allows_spreadsheet_headers():
    assert quote_ident("Available K (kg/ha)") == '"Available K (kg/ha)"'
    assert quote_ident("Sample ID") == '"Sample ID"'
    assert quote_ident('pH "water"') == '"pH ""water"""'


def test_quote_ident_rejects_empty_and_control_characters():
    with pytest.raises(HTTPException):
        quote_ident("")
    with pytest.raises(HTTPException):
        quote_ident("Sample\nID")


def test_stale_window_matches_conversion_task_limit():
    assert CONVERSION_TASK_TIME_LIMIT >= 1800
    service = VisualizationService(None, None)

    class Row:
        status = "processing"
        created_on = datetime.now(timezone.utc) - timedelta(seconds=400)

    assert service._is_stale(Row()) is False
    Row.created_on = datetime.now(timezone.utc) - timedelta(
        seconds=CONVERSION_TASK_TIME_LIMIT + 5
    )
    assert service._is_stale(Row()) is True
