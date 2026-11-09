"""Visualization access: cloud-native lookup, conversion enqueue, DuckDB charts."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import UUID, uuid4

from core.config import settings
from fastapi import HTTPException, status
from models.converted_file import ConvertedFile, FileAccessLog
from models.file import File
from models.user import User
from services.formats import (
    STATUS_AVAILABLE,
    STATUS_PROCESSING,
    STATUS_REMOVED,
    FormatPlan,
    mime_for_cloud_format,
    plan_for_format,
)
from services.spreadsheet_header import (
    HEADER_SCAN_ROWS,
    detect_header_offset,
    infer_column_type,
    unique_headers,
)
from services.raster_georef import GEOREF_OK
from services.upload import UploadService
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_ALLOWED_AGG = {"sum", "avg", "min", "max", "count"}
CONVERSION_STALE_SECONDS = 90
# Matches cpu.convert_file time_limit. Do not use the shorter email-worker limit.
CONVERSION_TASK_TIME_LIMIT = 2100


def quote_ident(name: str) -> str:
    """Quote a spreadsheet header for DuckDB.

    Headers often contain spaces, parentheses, and units such as
    ``Available K (kg/ha)``. Doubling embedded quotes keeps the name an
    identifier, so it cannot change the query.
    """
    if not isinstance(name, str) or not name or len(name) > 120:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid column name",
        )
    if any(ord(ch) < 32 for ch in name):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid column name",
        )
    return '"' + name.replace('"', '""') + '"'


def _sql_literal(value: str) -> str:
    return str(value).replace("'", "''")


def _s3_credentials() -> tuple[str, str, str]:
    """Return S3 credentials for DuckDB.

    Explicit keys in .env win. Otherwise use boto3's credential chain, which
    covers the EC2 instance role used in production. DuckDB's plain
    ``SET s3_*`` settings do not read the instance role on their own, so
    without this every Parquet read fails with 403 when the keys are blank.
    Role credentials are temporary, so the session token is passed too.
    """
    key = (settings.AWS_ACCESS_KEY_ID or "").strip()
    secret = (settings.AWS_SECRET_ACCESS_KEY or "").strip()
    if key and secret:
        return key, secret, ""
    try:
        import boto3

        creds = boto3.Session().get_credentials()
        if creds is None:
            return "", "", ""
        frozen = creds.get_frozen_credentials()
        return frozen.access_key or "", frozen.secret_key or "", frozen.token or ""
    except Exception:
        logger.exception("Could not resolve AWS credentials for DuckDB")
        return "", "", ""


class VisualizationService:
    def __init__(self, session: AsyncSession, upload_service: UploadService):
        self.session = session
        self.upload_service = upload_service
        self.logger = logging.getLogger(__name__)

    async def _rows(
        self, native_file_id: UUID, include_removed: bool = False
    ) -> list[ConvertedFile]:
        """Cloud-native records for a file, newest first."""
        query = select(ConvertedFile).where(ConvertedFile.native_file_id == native_file_id)
        if not include_removed:
            query = query.where(ConvertedFile.status != STATUS_REMOVED)
        result = await self.session.execute(query.order_by(ConvertedFile.created_on.desc()))
        return list(result.scalars().all())

    async def latest_converted(self, native_file_id: UUID) -> Optional[ConvertedFile]:
        """The record to use: the newest available one, else the newest at all.

        Preferring an available record means a later failed or running
        attempt never hides a copy that already works.
        """
        # Removed records are included so a failed conversion is reported
        # to the polling preview instead of looking like one still running.
        rows = await self._rows(native_file_id, include_removed=True)
        for row in rows:
            if row.status == STATUS_AVAILABLE:
                return row
        return rows[0] if rows else None

    async def statuses_for_files(self, file_ids: list[UUID]) -> dict[UUID, str]:
        if not file_ids:
            return {}
        result = await self.session.execute(
            select(ConvertedFile.native_file_id, ConvertedFile.status)
            .where(ConvertedFile.native_file_id.in_(file_ids))
            .where(ConvertedFile.status != STATUS_REMOVED)
        )
        out: dict[UUID, str] = {}
        for native_id, status_value in result.all():
            current = out.get(native_id)
            if current == STATUS_AVAILABLE:
                continue
            if status_value == STATUS_AVAILABLE or current is None:
                out[native_id] = status_value
        return out

    async def delete_converted_objects(self, native_file_id: UUID) -> None:
        result = await self.session.execute(
            select(ConvertedFile).where(ConvertedFile.native_file_id == native_file_id)
        )
        rows = list(result.scalars().all())
        for row in rows:
            if not row.file_key:
                continue
            native = await self.session.get(File, native_file_id)
            if native is not None and row.file_key == native.file_key:
                continue
            try:
                await self.upload_service.delete_object(row.file_key)
            except Exception:
                self.logger.warning(
                    "Failed to delete converted object %s", row.file_key
                )

    def _plan(self, file_record: File) -> FormatPlan:
        plan = plan_for_format(file_record.file_format, file_record.file_key)
        if plan is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This file type cannot be visualised",
            )
        return plan

    async def _touch_and_log(
        self,
        converted: ConvertedFile,
        user: Optional[User],
    ) -> None:
        now = datetime.now(timezone.utc)
        await self.session.execute(
            update(ConvertedFile)
            .where(ConvertedFile.cloud_file_id == converted.cloud_file_id)
            .values(last_accessed=now)
        )
        self.session.add(
            FileAccessLog(
                cloud_file_id=converted.cloud_file_id,
                native_file_id=converted.native_file_id,
                accessed_time=now,
                user_id=user.id if user is not None else None,
            )
        )
        await self.session.commit()
        converted.last_accessed = now

    async def _presign(self, converted: ConvertedFile) -> dict[str, Any]:
        data = await self.upload_service.get_presigned_download_url(
            converted.file_key,
            inline=True,
            content_type=mime_for_cloud_format(converted.format),
        )
        return {
            "access_url": data.get("download_url"),
            "key": converted.file_key,
            "expires_in": data.get("expires_in"),
        }

    def _payload(
        self,
        file_record: File,
        plan: FormatPlan,
        converted: Optional[ConvertedFile],
        extra: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        status_value = converted.status if converted else STATUS_PROCESSING
        body: dict[str, Any] = {
            "native_file_id": str(file_record.file_id),
            "cloud_file_id": str(converted.cloud_file_id) if converted else None,
            "viewer": plan.viewer,
            "format": converted.format if converted else plan.target_format,
            "status": status_value,
            "cloud_native": plan.cloud_native or status_value == STATUS_AVAILABLE,
        }
        if extra:
            body.update(extra)
        if status_value == STATUS_AVAILABLE and converted is not None:
            titiler = (settings.TITILER_BASE_URL or "").rstrip("/")
            if plan.viewer == "raster_map" and titiler:
                body["titiler_url"] = f"{titiler}/cog"
                body["bidx"] = 1
                # The viewer computes the stretch from the raster's own
                # statistics. A fixed 0,255 range paints small-valued
                # rasters (indices, rainfall, temperature) one flat colour.
                body["rescale"] = None
                body["colormap_name"] = "viridis"
            if plan.viewer == "raster_map":
                body["georef_status"] = converted.georef_status or GEOREF_OK
                body["georef_note"] = converted.georef_note or ""
        return body

    def _is_stale(self, converted: ConvertedFile) -> bool:
        if converted.status != STATUS_PROCESSING:
            return False
        created = converted.created_on
        if created is None:
            return False
        if created.tzinfo is None:
            created = created.replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - created
        limit = timedelta(seconds=CONVERSION_TASK_TIME_LIMIT)
        return age > limit

    async def access_file(self, file_record: File, user: Optional[User]) -> dict[str, Any]:
        """Return the cloud-optimised file to show, converting only when needed.

        1. Is the upload itself already cloud-optimised? Formats that are
           cloud-native by nature (PDF, Parquet, FlatGeobuf, PMTiles, images)
           always are. A GeoTIFF is when it is a valid COG with sound
           georeferencing. It is then shown as uploaded, never converted.
        2. Has the platform already converted it? An available record in
           converted_files is reused. (Checked before reading the upload's
           header, since a converted file is by definition not a COG.)
        3. Otherwise, is a conversion already running? Wait for it.
        4. Otherwise, convert it once.

        The answer to step 1 is stored as a record pointing at the uploaded
        file, so the header is read from S3 only on the first view.
        """
        plan = self._plan(file_record)
        bucket = file_record.bucket or settings.S3_BUCKET
        native_key = file_record.file_key
        rows = await self._rows(file_record.file_id)
        available = [r for r in rows if r.status == STATUS_AVAILABLE]

        # Step 1a: the upload was already found to be cloud-optimised.
        native_row = next((r for r in available if r.file_key == native_key), None)
        if native_row is not None and await self._still_sound(native_row, plan, file_record):
            return await self._serve(file_record, plan, native_row, user)

        # Step 2: a copy the platform already optimised. If one exists, the
        # upload was already found not to be cloud-optimised, so its header
        # is not read again.
        for row in available:
            if row.file_key == native_key:
                continue
            if await self._still_sound(row, plan, file_record):
                return await self._serve(file_record, plan, row, user)

        # Step 1b: first view; check the upload itself.
        sound_cog = await self._sound_native_cog(plan, bucket, file_record)
        if plan.cloud_native or sound_cog:
            row = ConvertedFile(
                cloud_file_id=uuid4(),
                native_file_id=file_record.file_id,
                bucket=bucket,
                file_key=native_key,
                format=plan.target_format,
                status=STATUS_AVAILABLE,
                last_accessed=datetime.now(timezone.utc),
                georef_status=GEOREF_OK if sound_cog else None,
            )
            self.session.add(row)
            await self.session.commit()
            await self.session.refresh(row)
            return await self._serve(file_record, plan, row, user)

        # Step 3: a conversion already under way.
        running = await self._running_conversion(file_record.file_id)
        if running is not None:
            return self._payload(file_record, plan, running)

        # Step 4: convert once.
        row = ConvertedFile(
            cloud_file_id=uuid4(),
            native_file_id=file_record.file_id,
            bucket=bucket,
            file_key="",
            format=plan.target_format,
            status=STATUS_PROCESSING,
        )
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        self._enqueue_conversion(row.cloud_file_id)
        return self._payload(file_record, plan, row)

    async def _serve(
        self,
        file_record: File,
        plan: FormatPlan,
        row: ConvertedFile,
        user: Optional[User],
    ) -> dict[str, Any]:
        await self._touch_and_log(row, user)
        extra = await self._presign(row)
        return self._payload(file_record, plan, row, extra)

    async def _running_conversion(self, native_file_id: UUID) -> Optional[ConvertedFile]:
        """A live processing record, after retiring any that timed out.

        On PostgreSQL a per-file advisory lock is taken first, so two people
        opening a new file at the same moment start one conversion, not two.
        The lock is released by the commit that follows.
        """
        await self._lock_file(native_file_id)
        running = None
        for row in await self._rows(native_file_id):
            if row.status != STATUS_PROCESSING:
                continue
            if self._is_stale(row):
                row.status = STATUS_REMOVED
                await self.session.commit()
                await self._lock_file(native_file_id)
            elif running is None:
                running = row
        return running

    async def _lock_file(self, native_file_id: UUID) -> None:
        bind = getattr(self.session, "bind", None)
        dialect = getattr(getattr(bind, "dialect", None), "name", "")
        if dialect != "postgresql":
            return
        from sqlalchemy import text

        await self.session.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"),
            {"key": f"convert:{native_file_id}"},
        )

    async def _still_sound(
        self, row: ConvertedFile, plan: FormatPlan, file_record: File
    ) -> bool:
        """True when an available record can be shown as it is.

        Raster records made before the georeferencing check (georef_status
        NULL) are checked again from their header, which costs a few ranged
        reads, not a conversion. A sound one is marked and reused; only one
        whose location is wrong is retired so it can be fixed.
        """
        if plan.viewer != "raster_map" or row.georef_status is not None:
            return True
        if await self._sound_cog_at(row.bucket or settings.S3_BUCKET, row.file_key):
            row.georef_status = GEOREF_OK
            await self.session.commit()
            return True
        await self._supersede(row, file_record)
        return False

    async def _sound_native_cog(
        self, plan: FormatPlan, bucket: str, file_record: File
    ) -> bool:
        """True when an uploaded GeoTIFF can be served as is, with no conversion.

        Reads only the TIFF header (a few ranged GETs). The file must be a
        COG, name an EPSG code, and convert cleanly to longitude/latitude.
        Anything less certain (no CRS, a user-defined CRS, coordinates that
        do not match the CRS) goes to the conversion worker, where GDAL reads
        the full definition and fixes what it can.
        """
        if plan.conversion != "cog":
            return False
        return await self._sound_cog_at(bucket, file_record.file_key)

    async def _sound_cog_at(self, bucket: str, key: str) -> bool:
        """COG layout, an EPSG code, and coordinates that fit it, from the header."""
        if not key:
            return False
        from services import cog_check
        from services.raster_georef import (
            RasterGeoref,
            assess,
            parse_candidates,
            parse_region,
        )
        from services.upload import get_s3_client

        found = await asyncio.to_thread(cog_check.inspect_s3_tiff, get_s3_client(), bucket, key)
        if not found.is_cog or found.epsg is None or found.geotransform is None:
            return False
        decision = assess(
            RasterGeoref(found.width, found.height, found.geotransform, f"EPSG:{found.epsg}"),
            parse_candidates(settings.RASTER_CRS_CANDIDATES),
            parse_region(settings.RASTER_EXPECTED_REGION),
        )
        return decision.status == GEOREF_OK

    async def _supersede(self, converted: ConvertedFile, file_record: File) -> None:
        """Retire a derivative so the file is processed again."""
        converted.status = STATUS_REMOVED
        await self.session.commit()
        if converted.file_key and converted.file_key != file_record.file_key:
            try:
                await self.upload_service.delete_object(converted.file_key)
            except Exception:
                self.logger.warning(
                    "Could not delete superseded derivative %s", converted.file_key
                )

    def _enqueue_conversion(self, cloud_file_id: UUID) -> None:
        from core.celery import celery_app

        celery_app.send_task(
            "cpu.convert_file",
            args=[str(cloud_file_id)],
            queue="cpu",
        )

    async def conversion_status(self, file_record: File) -> dict[str, Any]:
        plan = self._plan(file_record)
        converted = await self.latest_converted(file_record.file_id)
        if converted and converted.status == STATUS_AVAILABLE:
            extra = await self._presign(converted)
            return self._payload(file_record, plan, converted, extra)
        if converted and converted.status == STATUS_REMOVED:
            return {
                **self._payload(file_record, plan, converted),
                "error": "Conversion failed or was removed",
            }
        if converted and self._is_stale(converted):
            return {
                **self._payload(file_record, plan, converted),
                "status": STATUS_REMOVED,
                "error": "Conversion timed out",
            }
        return self._payload(file_record, plan, converted)

    def _duckdb_parquet_sql(self, bucket: str, file_key: str) -> str:
        path = f"s3://{bucket}/{file_key}".replace("'", "''")
        return f"read_parquet('{path}')"

    def _sheet_from(self, con: Any, src: str) -> tuple[str, bool]:
        """Read a table, skipping title and filter rows above the header.

        Files converted before header detection stored the report title as
        the column names and the real header as a data row. This projects
        those files onto the real columns. A normal table is returned as-is.
        """
        try:
            described = con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()
            names = [column[0] for column in described]
            sample = con.execute(
                f"SELECT * FROM {src} LIMIT {HEADER_SCAN_ROWS}"
            ).fetchall()
        except Exception:
            self.logger.exception("Could not inspect table preamble")
            return src, False
        if not names:
            return src, False
        logical = [names] + [list(row) for row in sample]
        offset = detect_header_offset(logical, column_names_as_first_row=True)
        if offset <= 0 or offset >= len(logical):
            return src, False
        new_names = unique_headers(logical[offset], len(names))
        try:
            select_list = ", ".join(
                f"{quote_ident(old)} AS {quote_ident(new)}"
                for old, new in zip(names, new_names)
            )
        except HTTPException:
            self.logger.warning("Could not quote repaired spreadsheet headers")
            return src, False
        from_item = (
            f"(SELECT {select_list} FROM ("
            f"SELECT *, row_number() OVER () AS __dw_rn FROM {src}"
            f") WHERE __dw_rn > {int(offset)}) AS _sheet"
        )
        try:
            con.execute(f"SELECT * FROM {from_item} LIMIT 0")
        except Exception:
            self.logger.exception(
                "Repaired spreadsheet query failed; using original columns"
            )
            return src, False
        self.logger.info("Skipping %s preamble rows in converted table", offset)
        return from_item, True

    def _configure_duckdb(self, con: Any) -> None:
        con.execute("INSTALL httpfs")
        con.execute("LOAD httpfs")
        con.execute(f"SET s3_region='{_sql_literal(settings.S3_REGION)}'")
        key, secret, token = _s3_credentials()
        if key and secret:
            con.execute(f"SET s3_access_key_id='{_sql_literal(key)}'")
            con.execute(f"SET s3_secret_access_key='{_sql_literal(secret)}'")
        if token:
            con.execute(f"SET s3_session_token='{_sql_literal(token)}'")

    async def _require_parquet(self, file_record: File) -> ConvertedFile:
        plan = self._plan(file_record)
        if plan.viewer != "table_chart":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Chart and table queries are only available for tabular files",
            )
        converted = await self.latest_converted(file_record.file_id)
        if converted is None or converted.status != STATUS_AVAILABLE:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cloud-native Parquet file is not ready",
            )
        return converted

    async def table_schema(self, file_record: File) -> dict[str, Any]:
        converted = await self._require_parquet(file_record)
        try:
            import duckdb
        except ImportError as exc:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="DuckDB is not available on the server",
            ) from exc
        con = duckdb.connect(database=":memory:")
        try:
            self._configure_duckdb(con)
            src = self._duckdb_parquet_sql(converted.bucket, converted.file_key)
            from_item, repaired = self._sheet_from(con, src)
            cols = con.execute(f"DESCRIBE SELECT * FROM {from_item}").fetchall()
            count_row = con.execute(f"SELECT COUNT(*) FROM {from_item}").fetchone()
            sample = []
            if repaired:
                sample = con.execute(
                    f"SELECT * FROM {from_item} LIMIT {HEADER_SCAN_ROWS}"
                ).fetchall()
        except Exception as exc:
            self.logger.exception("DuckDB schema failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to read tabular schema",
            ) from exc
        finally:
            con.close()
        columns = [{"name": column[0], "type": column[1]} for column in cols]
        if repaired and sample:
            for index, column in enumerate(columns):
                values = [
                    row[index] if index < len(row) else None for row in sample
                ]
                if infer_column_type(values) == "DOUBLE":
                    column["type"] = "DOUBLE"
        return {
            "columns": columns,
            "row_count": int(count_row[0]) if count_row else 0,
            "viewer": "table_chart",
        }

    async def table_rows(
        self, file_record: File, limit: int, offset: int
    ) -> dict[str, Any]:
        converted = await self._require_parquet(file_record)
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        import duckdb

        con = duckdb.connect(database=":memory:")
        try:
            self._configure_duckdb(con)
            src = self._duckdb_parquet_sql(converted.bucket, converted.file_key)
            from_item, _repaired = self._sheet_from(con, src)
            headers = [
                column[0]
                for column in con.execute(
                    f"DESCRIBE SELECT * FROM {from_item}"
                ).fetchall()
            ]
            rows = con.execute(
                f"SELECT * FROM {from_item} LIMIT {limit} OFFSET {offset}"
            ).fetchall()
        except Exception as exc:
            self.logger.exception("DuckDB table read failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to read tabular data",
            ) from exc
        finally:
            con.close()
        return {
            "headers": headers,
            "rows": [list(r) for r in rows],
            "limit": limit,
            "offset": offset,
        }

    async def chart_data(
        self,
        file_record: File,
        x_column: str,
        y_columns: list[dict[str, str]],
        limit: int,
    ) -> dict[str, Any]:
        converted = await self._require_parquet(file_record)
        if not y_columns:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="At least one Y column is required",
            )
        limit = max(1, min(int(limit), 500))
        x_sql = quote_ident(x_column)
        select_parts = [f"{x_sql} AS x"]
        aliases: list[str] = []
        for i, spec in enumerate(y_columns[:8]):
            col = spec.get("column") or ""
            agg = (spec.get("aggregation") or "sum").lower()
            if agg not in _ALLOWED_AGG:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Unsupported aggregation",
                )
            alias = f"y{i}"
            aliases.append(spec.get("label") or f"{agg}({col})")
            if agg == "count":
                select_parts.append(f"COUNT(*) AS {alias}")
            else:
                col_sql = quote_ident(col)
                # Excel columns often arrive as text. Cast so units like
                # "Available K (kg/ha)" still plot.
                select_parts.append(
                    f"{agg.upper()}(TRY_CAST({col_sql} AS DOUBLE)) AS {alias}"
                )
        import duckdb

        con = duckdb.connect(database=":memory:")
        try:
            self._configure_duckdb(con)
            src = self._duckdb_parquet_sql(converted.bucket, converted.file_key)
            from_item, _repaired = self._sheet_from(con, src)
            sql = (
                f"SELECT {', '.join(select_parts)} FROM {from_item} "
                f"GROUP BY 1 ORDER BY 1 LIMIT {limit}"
            )
            rows = con.execute(sql).fetchall()
        except HTTPException:
            raise
        except Exception as exc:
            self.logger.exception("DuckDB chart query failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to aggregate chart data",
            ) from exc
        finally:
            con.close()
        series = []
        for row in rows:
            point = {"x": row[0] if row[0] is not None else ""}
            for i in range(len(aliases)):
                val = row[i + 1]
                point[f"y{i}"] = float(val) if val is not None else None
            series.append(point)
        return {"points": series, "series": aliases, "x_column": x_column}
