from datetime import date, datetime, timezone

import pytest

from utils.temporal import parse_coverage_date


def test_date_only():
    assert parse_coverage_date("2024-03-15") == date(2024, 3, 15)


def test_legacy_datetime_uses_utc_calendar_day():
    assert parse_coverage_date("2024-03-15T23:30:00Z") == date(2024, 3, 15)
    late = datetime(2024, 3, 15, 23, 30, tzinfo=timezone.utc)
    assert parse_coverage_date(late) == date(2024, 3, 15)


def test_blank_is_none():
    assert parse_coverage_date(None) is None
    assert parse_coverage_date("  ") is None


def test_invalid():
    with pytest.raises(ValueError):
        parse_coverage_date("15/03/2024")
