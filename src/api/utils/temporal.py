"""Date-only temporal coverage. Legacy timestamps keep their UTC calendar day."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional, Union


def parse_coverage_date(value: Optional[Union[str, date, datetime]]) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        else:
            value = value.astimezone(timezone.utc)
        return value.date()
    if isinstance(value, date):
        return value
    if not isinstance(value, str):
        raise ValueError("Temporal coverage must be a date")
    text = value.strip()
    if not text:
        return None
    if len(text) >= 10 and text[4] == "-" and text[7] == "-":
        try:
            return date.fromisoformat(text[:10])
        except ValueError:
            pass
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("Temporal coverage must be a date (YYYY-MM-DD)") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    else:
        parsed = parsed.astimezone(timezone.utc)
    return parsed.date()
