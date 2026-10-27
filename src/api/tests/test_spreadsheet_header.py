from services.spreadsheet_header import (
    detect_header_offset,
    excel_column_letter,
    infer_column_type,
    unique_headers,
    used_column_count,
)

DAM_HEADER = [
    "Project Identification Code",
    "Name of Dam",
    "Dam Type",
    "Year of construction",
    "District",
    "Height above foundation",
    "Gross Storage",
    "Live Storage",
    "Purpose",
    "Designed Spillway Capacity m3/sec",
]


def test_header_on_first_row_is_kept():
    rows = [
        ["Name", "District", "Height", "Storage"],
        ["Hiresingar", "Bagalkot", "11.45", "3.05"],
    ]
    assert detect_header_offset(rows) == 0


def test_title_and_filter_rows_are_skipped():
    rows = [
        ["CWC_NRLD_2019_Report", None, None, None, None, None, None, None, None, None],
        ["District :", "-All-", "Taluk :", "-All-", None, None, None, None, None, None],
        [None, None, None, None, None, None, None, None, None, None],
        DAM_HEADER,
        ["KA06LH0192", "Hiresingar", "Minor", "1993", "Bagalkot", "11.45", "3.05", "0.32", "Irrig.", "156.48"],
    ]
    assert detect_header_offset(rows) == 3


def test_filter_row_above_the_header_is_skipped():
    rows = [
        ["District :", "-All-", "Taluk :", "-All-", None, None, None, None, None, None],
        DAM_HEADER,
        ["KA06LH0192", "Hiresingar", "Minor", "1993", "Bagalkot", "11.45", "3.05", "0.32", "Irrig.", "156.48"],
    ]
    assert detect_header_offset(rows) == 1


def test_repeated_title_banner_is_skipped():
    rows = [
        ["CWC_NRLD_2019_Report"] * len(DAM_HEADER),
        DAM_HEADER,
        ["KA06LH0192", "Hiresingar", "Minor", "1993", "Bagalkot", "11.45", "3.05", "0.32", "Irrig.", "156.48"],
    ]
    assert detect_header_offset(rows) == 1


def test_text_records_before_a_number_do_not_move_the_header():
    rows = [
        ["Name", "District", "Code", "Notes"],
        ["Hiresingar", "Bagalkot", "KA01", "see file"],
        ["Obichudan", "Bengaluru", "KA02", "irrigated"],
        ["Dam", "Belagavi", "KA03", "11.45"],
    ]
    assert detect_header_offset(rows) == 0


def test_narrow_table_keeps_its_header():
    assert detect_header_offset([["Name", "Value"], ["A", "10"]]) == 0


def test_title_above_a_narrow_table_is_skipped():
    rows = [
        ["Annual report"],
        ["Name", "Value"],
        ["A", "10"],
    ]
    assert detect_header_offset(rows) == 1


def test_sheet_without_numbers_keeps_the_first_row():
    rows = [
        ["Note"],
        ["Name", "District"],
        ["Hiresingar", "Bagalkot"],
    ]
    assert detect_header_offset(rows) == 0


def test_imported_column_names_recover_the_real_header():
    """A previous import used the title row, so blank cells became columnN."""
    names = ["CWC_NRLD_2019_Report"] + [f"column{i}" for i in range(1, len(DAM_HEADER))]
    rows = [
        names,
        ["District :", "-All-", "Taluk :", "-All-"] + [None] * (len(DAM_HEADER) - 4),
        DAM_HEADER,
        ["KA06LH0192", "Hiresingar", "Minor", "1993", "Bagalkot", "11.45", "3.05", "0.32", "Irrig.", "156.48"],
    ]
    assert detect_header_offset(rows, column_names_as_first_row=True) == 2


def test_imported_filter_row_recovers_the_real_header():
    names = ["District :", "-All-", "Taluk :", "-All-"] + [
        f"column{i}" for i in range(4, len(DAM_HEADER))
    ]
    rows = [
        names,
        DAM_HEADER,
        ["KA06LH0192", "Hiresingar", "Minor", "1993", "Bagalkot", "11.45", "3.05", "0.32", "Irrig.", "156.48"],
    ]
    assert detect_header_offset(rows, column_names_as_first_row=True) == 1


def test_unique_headers_fill_blanks_and_duplicates():
    assert unique_headers(["Name", "", "Name", "Height (m)"], 4) == [
        "Name",
        "column2",
        "Name (2)",
        "Height (m)",
    ]


def test_infer_column_type_treats_measurement_text_as_numeric():
    assert infer_column_type(["11.45", "26", None, "15.8"]) == "DOUBLE"
    assert infer_column_type(["Hiresingar", "Bidi Tank", "11.45"]) == "VARCHAR"


def test_excel_column_letters_and_used_width():
    assert excel_column_letter(1) == "A"
    assert excel_column_letter(13) == "M"
    assert excel_column_letter(27) == "AA"
    rows = [
        ["CWC_NRLD_2019_Report", None, None],
        ["Code", "Name", "Height"],
    ]
    assert used_column_count(rows) == 3
    wide = [["x"] * 4]
    assert used_column_count(wide, scan_width=4) == 16384
