"""On-the-fly conversion of native uploads to cloud-native formats.

Runs only on the isolated Celery CPU worker (not the API process).
"""

from __future__ import annotations

import csv
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Sequence

from services.formats import VECTOR_FEATURE_LIMIT
from services.spreadsheet_header import (
    HEADER_SCAN_ROWS,
    detect_header_offset,
    excel_column_letter,
    used_column_count,
)

logger = logging.getLogger(__name__)


class ConversionError(Exception):
    """Raised when a native file cannot be converted."""


def _run(cmd: list[str], timeout: int) -> subprocess.CompletedProcess[str]:
    logger.info("Conversion command: %s", " ".join(cmd))
    try:
        return subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError("Conversion timed out") from exc
    except FileNotFoundError as exc:
        raise ConversionError(f"Required tool is not installed: {cmd[0]}") from exc
    except subprocess.CalledProcessError as exc:
        stderr = (exc.stderr or "")[-2000:]
        raise ConversionError(f"{cmd[0]} failed: {stderr}") from exc


def _soffice_bin() -> str:
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    raise ConversionError("LibreOffice headless is not installed")


def convert_to_pdf(src: Path, dest_dir: Path, timeout: int) -> Path:
    dest_dir.mkdir(parents=True, exist_ok=True)
    _run(
        [
            _soffice_bin(),
            "--headless",
            "--norestore",
            "--convert-to",
            "pdf",
            "--outdir",
            str(dest_dir),
            str(src),
        ],
        timeout=timeout,
    )
    pdfs = list(dest_dir.glob("*.pdf"))
    if not pdfs:
        raise ConversionError("LibreOffice did not produce a PDF")
    return pdfs[0]


def _spreadsheet_to_csv(src: Path, dest_dir: Path, timeout: int) -> Path:
    """LibreOffice reads xls, xlsm, xlsb, and the template formats DuckDB cannot."""
    dest_dir.mkdir(parents=True, exist_ok=True)
    _run(
        [
            _soffice_bin(),
            "--headless",
            "--norestore",
            "--convert-to",
            "csv",
            "--outdir",
            str(dest_dir),
            str(src),
        ],
        timeout=timeout,
    )
    csvs = list(dest_dir.glob("*.csv"))
    if not csvs:
        raise ConversionError("Could not convert spreadsheet to CSV")
    return csvs[0]


# Columns inspected while looking for a title row above the real header.
_XLSX_SNIFF_COLUMNS = 128


def _sql_path(path: Path) -> str:
    return str(path).replace("'", "''")


def _header_skip(rows: Sequence[Sequence[object]]) -> int:
    try:
        skip = detect_header_offset(rows)
    except Exception:
        logger.exception("Spreadsheet header detection failed")
        return 0
    if not isinstance(skip, int) or skip <= 0:
        return 0
    return min(skip, HEADER_SCAN_ROWS - 1)


def _sample_delimited(path: Path, delimiter: str) -> list[list[str]]:
    rows: list[list[str]] = []
    with path.open(newline="", encoding="utf-8-sig", errors="replace") as handle:
        reader = csv.reader(handle, delimiter=delimiter)
        for index, row in enumerate(reader):
            if index >= HEADER_SCAN_ROWS:
                break
            rows.append(row)
    return rows


def _delimited_source(path_s: str, delimiter: str, skip: int) -> str:
    sql_delim = "\\t" if delimiter == "\t" else delimiter
    skip_sql = f", skip={int(skip)}" if skip > 0 else ""
    return f"read_csv_auto('{path_s}', delim='{sql_delim}', header=true{skip_sql})"


def _copy_query(con, source_sql: str, dest_s: str) -> None:
    con.execute(
        f"COPY (SELECT * FROM {source_sql}) TO '{dest_s}' (FORMAT PARQUET)"
    )


def _copy_delimited_to_parquet(
    con, src: Path, dest_s: str, delimiter: str
) -> None:
    skip = _header_skip(_sample_delimited(src, delimiter))
    if skip:
        logger.info(
            "Skipping %s leading rows before the header in %s", skip, src.name
        )
    _copy_query(con, _delimited_source(_sql_path(src), delimiter, skip), dest_s)


def _sniff_xlsx(con, src_s: str):
    end = excel_column_letter(_XLSX_SNIFF_COLUMNS)
    # An explicit range keeps blank rows between a title and the header.
    # Without it, DuckDB stops at the first empty row.
    return con.execute(
        "SELECT * FROM read_xlsx("
        f"'{src_s}', header=false, all_varchar=true, "
        f"range='A1:{end}{HEADER_SCAN_ROWS}')"
    ).fetchall()


def _xlsx_source(src_s: str, skip: int, width: int) -> str:
    if skip <= 0:
        return f"read_xlsx('{src_s}', header=true)"
    start = skip + 1
    end = excel_column_letter(max(width, 1))
    return (
        f"read_xlsx('{src_s}', header=true, stop_at_empty=true, "
        f"range='A{start}:{end}')"
    )


def _copy_xlsx_to_parquet(con, src_s: str, dest_s: str) -> None:
    con.execute("INSTALL excel")
    con.execute("LOAD excel")
    skip = 0
    width = 1
    try:
        sample = _sniff_xlsx(con, src_s)
        skip = _header_skip(sample)
        width = used_column_count(sample, _XLSX_SNIFF_COLUMNS) if sample else 1
    except Exception:
        logger.exception("Could not detect the Excel header; using the first row")
        skip = 0
    if skip:
        logger.info("Skipping %s leading Excel rows before the header", skip)
    try:
        _copy_query(con, _xlsx_source(src_s, skip, width), dest_s)
    except Exception:
        if skip <= 0:
            raise
        logger.exception("Header-aware Excel read failed; using the first row")
        _copy_query(con, _xlsx_source(src_s, 0, width), dest_s)


def convert_to_parquet(src: Path, dest: Path, timeout: int) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        import duckdb
    except ImportError as exc:
        raise ConversionError("DuckDB is not installed on the conversion worker") from exc

    con = duckdb.connect(database=":memory:")
    src_s = str(src).replace("'", "''")
    dest_s = str(dest).replace("'", "''")
    suffix = src.suffix.lower()
    other_excel = {".xls", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm"}
    try:
        if suffix in {".csv", ".tsv"}:
            _copy_delimited_to_parquet(
                con, src, dest_s, "\t" if suffix == ".tsv" else ","
            )
        elif suffix in other_excel:
            csv_path = _spreadsheet_to_csv(src, dest.parent / "excel_csv", timeout)
            _copy_delimited_to_parquet(con, csv_path, dest_s, ",")
        else:
            try:
                _copy_xlsx_to_parquet(con, src_s, dest_s)
            except Exception:
                csv_path = _spreadsheet_to_csv(src, dest.parent / "xlsx_csv", timeout)
                _copy_delimited_to_parquet(con, csv_path, dest_s, ",")
    except ConversionError:
        raise
    except Exception as exc:
        raise ConversionError(f"Parquet conversion failed: {exc}") from exc
    finally:
        con.close()
    if not dest.exists():
        raise ConversionError("Parquet file was not created")
    return dest


def _ogr2ogr() -> str:
    path = shutil.which("ogr2ogr")
    if not path:
        raise ConversionError("GDAL ogr2ogr is not installed")
    return path


def _ogrinfo() -> Optional[str]:
    return shutil.which("ogrinfo")


def _count_features(src: Path, timeout: int) -> int:
    info = _ogrinfo()
    if not info:
        raise ConversionError("GDAL ogrinfo is not installed")
    proc = _run([info, "-so", "-al", str(src)], timeout=min(timeout, 120))
    total = 0
    found = False
    for line in (proc.stdout or "").splitlines():
        if "Feature Count" not in line:
            continue
        try:
            count = int(line.split(":")[-1].strip())
        except ValueError:
            continue
        if count < 0:
            continue
        total += count
        found = True
    if not found:
        raise ConversionError("Could not count vector features")
    return total


def convert_vector(src: Path, dest_dir: Path, timeout: int) -> tuple[Path, str]:
    dest_dir.mkdir(parents=True, exist_ok=True)
    count = _count_features(src, timeout)
    ogr = _ogr2ogr()
    if count > VECTOR_FEATURE_LIMIT:
        dest = dest_dir / "converted.pmtiles"
        _run(
            [ogr, "-f", "PMTiles", "-t_srs", "EPSG:4326", str(dest), str(src)],
            timeout=timeout,
        )
        if not dest.exists():
            raise ConversionError("PMTiles conversion failed")
        return dest, "pmtiles"
    dest = dest_dir / "converted.fgb"
    _run(
        [ogr, "-f", "FlatGeobuf", "-t_srs", "EPSG:4326", "-nlt", "PROMOTE_TO_MULTI", str(dest), str(src)],
        timeout=timeout,
    )
    if not dest.exists():
        raise ConversionError("FlatGeobuf conversion failed")
    return dest, "flatgeobuf"


def is_cog(src: Path, timeout: int) -> bool:
    """True when gdalinfo reports the file is already a Cloud Optimized GeoTIFF."""
    gdalinfo = shutil.which("gdalinfo")
    if not gdalinfo:
        return False
    try:
        proc = _run([gdalinfo, str(src)], timeout=min(timeout, 120))
    except ConversionError:
        return False
    text = f"{proc.stdout or ''}\n{proc.stderr or ''}"
    return "LAYOUT=COG" in text


def convert_cog(src: Path, dest: Path, timeout: int) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    gdal_translate = shutil.which("gdal_translate")
    if gdal_translate:
        _run(
            [
                gdal_translate,
                "-of",
                "COG",
                "-co",
                "COMPRESS=DEFLATE",
                "-co",
                "OVERVIEWS=IGNORE_EXISTING",
                str(src),
                str(dest),
            ],
            timeout=timeout,
        )
        return dest
    try:
        from rio_cogeo.cogeo import cog_translate
        from rio_cogeo.profiles import cog_profiles
    except ImportError as exc:
        raise ConversionError("Neither gdal_translate nor rio-cogeo is installed") from exc
    cog_translate(str(src), str(dest), cog_profiles.get("deflate"), in_memory=False, quiet=True)
    if not dest.exists():
        raise ConversionError("COG conversion failed")
    return dest


def convert_native(
    src: Path,
    work_dir: Path,
    conversion: str,
    timeout: int,
) -> tuple[Path, str]:
    if conversion == "pdf":
        return convert_to_pdf(src, work_dir / "pdf", timeout), "pdf"
    if conversion == "parquet":
        dest = work_dir / "converted.parquet"
        return convert_to_parquet(src, dest, timeout), "parquet"
    if conversion == "vector":
        return convert_vector(src, work_dir / "vector", timeout)
    if conversion == "cog":
        dest = work_dir / "converted.tif"
        return convert_cog(src, dest, timeout), "cog"
    raise ConversionError(f"Unknown conversion: {conversion}")
