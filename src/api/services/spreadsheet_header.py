"""Find the real header row in a spreadsheet.

Reports often put a title and filter lines above the column names, for
example ``CWC_NRLD_2019_Report`` and ``District : -All-``. Treating row 1
as the header then puts that title into the chart axis lists.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal
from typing import Sequence

# How many leading rows to inspect. Report titles sit well above this.
HEADER_SCAN_ROWS = 40
EXCEL_MAX_COLUMN = 16384
# DuckDB names a blank header cell ``column0``, ``column1``, ``column00``, ...
_GENERATED_COLUMN = re.compile(r"^column_?\d+$", re.IGNORECASE)
_DATE = re.compile(r"^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:\b|$)")
_DATE_DMY = re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}(?:\b|$)")


def cell_text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def is_number(text: str) -> bool:
    """True for plain numbers and for values that are really dates."""
    if not text:
        return False
    if _DATE.match(text) or _DATE_DMY.match(text):
        return True
    token = text.replace(",", "").replace(" ", "")
    if token.endswith("%"):
        token = token[:-1]
    if len(token) >= 2 and token[0] == "(" and token[-1] == ")":
        token = token[1:-1]
    try:
        float(token)
    except ValueError:
        return False
    return True


def _filled_cells(row: Sequence[object], *, blank_generated: bool) -> list[str]:
    filled: list[str] = []
    for value in row:
        text = cell_text(value)
        if blank_generated and _GENERATED_COLUMN.match(text):
            continue
        if text:
            filled.append(text)
    return filled


def detect_header_offset(
    rows: Sequence[Sequence[object]],
    *,
    column_names_as_first_row: bool = False,
) -> int:
    """Return how many leading rows to skip so the next row is the header.

    ``0`` means the first row is already the header. Pass
    ``column_names_as_first_row`` when ``rows[0]`` is a list of column
    names taken from a file that was imported with the wrong header.
    Generated names such as ``column1`` are treated as blank cells.
    """
    if not rows:
        return 0
    scan = list(rows[:HEADER_SCAN_ROWS])
    parsed: list[tuple[list[str], int]] = []
    for index, row in enumerate(scan):
        filled = _filled_cells(
            row,
            blank_generated=column_names_as_first_row and index == 0,
        )
        numbers = sum(1 for value in filled if is_number(value))
        parsed.append((filled, numbers))

    data_start = None
    for index, (filled, numbers) in enumerate(parsed):
        if len(filled) >= 2 and numbers >= 1 and numbers / len(filled) >= 0.25:
            data_start = index
            break
    if data_start is None or data_start == 0:
        return 0

    preamble = parsed[:data_start]
    max_width = max((len(filled) for filled, _numbers in preamble), default=0)
    if max_width < 2:
        return 0
    threshold = max(2, int(max_width * 0.6))
    header_index = None
    for index, (filled, numbers) in enumerate(preamble):
        if len(filled) < threshold:
            continue
        if numbers / len(filled) > 0.3:
            continue
        unique = {value.lower() for value in filled}
        # A merged title repeated across the row is not a header.
        if len(unique) <= 1 and len(filled) > 1:
            continue
        header_index = index
    if header_index is None or header_index == 0:
        return 0

    first_filled = parsed[0][0]
    first_unique = {value.lower() for value in first_filled}
    if len(first_unique) <= 1:
        return header_index
    header_width = len(parsed[header_index][0])
    if len(first_filled) >= header_width * 0.6 and len(first_filled) >= 2:
        return 0
    return header_index


def clean_header_name(value: object, index: int) -> str:
    text = "".join(ch for ch in cell_text(value) if ord(ch) >= 32)
    text = text[:120].strip()
    if not text:
        return f"column{index + 1}"
    return text


def unique_headers(cells: Sequence[object], width: int) -> list[str]:
    """Column names for one header row, padded and de-duplicated."""
    names: list[str] = []
    used: set[str] = set()
    for index in range(max(0, width)):
        raw = cells[index] if index < len(cells) else ""
        base = clean_header_name(raw, index)
        name = base
        copy = 2
        while name.lower() in used:
            suffix = f" ({copy})"
            trimmed = base[: max(1, 120 - len(suffix))]
            name = f"{trimmed}{suffix}"
            copy += 1
        used.add(name.lower())
        names.append(name)
    return names


def infer_column_type(values: Sequence[object]) -> str:
    """``DOUBLE`` when the sampled values are numbers, otherwise ``VARCHAR``."""
    numeric = 0
    present = 0
    for value in values:
        if value is None or isinstance(value, bool):
            continue
        if isinstance(value, (date, datetime)):
            present += 1
            continue
        if isinstance(value, (int, float, Decimal)):
            present += 1
            numeric += 1
            continue
        text = cell_text(value)
        if not text:
            continue
        present += 1
        if is_number(text):
            numeric += 1
    if present and numeric / present >= 0.8:
        return "DOUBLE"
    return "VARCHAR"


def excel_column_letter(index: int) -> str:
    """1-based column index to Excel letters. 1 is A."""
    index = max(1, min(int(index), EXCEL_MAX_COLUMN))
    letters = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        letters = chr(65 + remainder) + letters
    return letters


def used_column_count(rows: Sequence[Sequence[object]], scan_width: int = 0) -> int:
    """Right-most filled column. A full scan window widens to the Excel limit."""
    width = 1
    saturated = False
    for row in rows:
        last = 0
        for index, value in enumerate(row):
            if cell_text(value):
                last = index + 1
        if scan_width and len(row) >= scan_width and last >= scan_width:
            saturated = True
        width = max(width, last)
    if saturated:
        return EXCEL_MAX_COLUMN
    return max(width, 1)
