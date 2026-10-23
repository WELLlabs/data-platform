"""On-the-fly conversion of native uploads to cloud-native formats.

Runs only on the isolated Celery CPU worker (not the API process).
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from services.formats import VECTOR_FEATURE_LIMIT

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


def _copy_csv_to_parquet(con, csv_path: Path, dest_s: str) -> None:
    csv_s = str(csv_path).replace("'", "''")
    con.execute(
        f"COPY (SELECT * FROM read_csv_auto('{csv_s}', header=true)) "
        f"TO '{dest_s}' (FORMAT PARQUET)"
    )


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
            delim = "\\t" if suffix == ".tsv" else ","
            con.execute(
                f"COPY (SELECT * FROM read_csv_auto('{src_s}', delim='{delim}', header=true)) "
                f"TO '{dest_s}' (FORMAT PARQUET)"
            )
        elif suffix in other_excel:
            csv_path = _spreadsheet_to_csv(src, dest.parent / "excel_csv", timeout)
            _copy_csv_to_parquet(con, csv_path, dest_s)
        else:
            try:
                con.execute("INSTALL excel")
                con.execute("LOAD excel")
                con.execute(
                    f"COPY (SELECT * FROM read_xlsx('{src_s}', header=true)) "
                    f"TO '{dest_s}' (FORMAT PARQUET)"
                )
            except Exception:
                csv_path = _spreadsheet_to_csv(src, dest.parent / "xlsx_csv", timeout)
                _copy_csv_to_parquet(con, csv_path, dest_s)
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
