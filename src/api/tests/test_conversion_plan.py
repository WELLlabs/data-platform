from datetime import datetime, timedelta, timezone

from services.formats import plan_for_format
from services.visualization import CONVERSION_TASK_TIME_LIMIT, VisualizationService


def test_document_and_table_plans():
    docx = plan_for_format("docx")
    assert docx is not None
    assert docx.target_format == "pdf"
    assert docx.conversion == "pdf"
    csv = plan_for_format("csv")
    assert csv is not None
    assert csv.target_format == "parquet"
    assert plan_for_format("xlsx") is None
    assert plan_for_format("geojson") is None


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
