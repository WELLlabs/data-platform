"""Visualization access: cloud-native lookup, conversion enqueue, DuckDB charts."""

from __future__ import annotations

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


class VisualizationService:
    def __init__(self, session: AsyncSession, upload_service: UploadService):
        self.session = session
        self.upload_service = upload_service
        self.logger = logging.getLogger(__name__)

    async def latest_converted(self, native_file_id: UUID) -> Optional[ConvertedFile]:
        result = await self.session.execute(
            select(ConvertedFile)
            .where(ConvertedFile.native_file_id == native_file_id)
            .order_by(ConvertedFile.created_on.desc())
        )
        return result.scalars().first()

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
                body["rescale"] = "0,255"
                body["colormap_name"] = "viridis"
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
        plan = self._plan(file_record)
        converted = await self.latest_converted(file_record.file_id)

        if converted and converted.status == STATUS_AVAILABLE:
            await self._touch_and_log(converted, user)
            extra = await self._presign(converted)
            return self._payload(file_record, plan, converted, extra)

        if converted and converted.status == STATUS_PROCESSING:
            if self._is_stale(converted):
                converted.status = STATUS_REMOVED
                await self.session.commit()
            else:
                return self._payload(file_record, plan, converted)

        bucket = file_record.bucket or settings.S3_BUCKET
        if plan.cloud_native:
            row = ConvertedFile(
                cloud_file_id=uuid4(),
                native_file_id=file_record.file_id,
                bucket=bucket,
                file_key=file_record.file_key,
                format=plan.target_format,
                status=STATUS_AVAILABLE,
                last_accessed=datetime.now(timezone.utc),
            )
            self.session.add(row)
            await self.session.commit()
            await self.session.refresh(row)
            await self._touch_and_log(row, user)
            extra = await self._presign(row)
            return self._payload(file_record, plan, row, extra)

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

    def _configure_duckdb(self, con: Any) -> None:
        con.execute("INSTALL httpfs")
        con.execute("LOAD httpfs")
        con.execute(f"SET s3_region='{settings.S3_REGION}'")
        key = (settings.AWS_ACCESS_KEY_ID or "").strip()
        secret = (settings.AWS_SECRET_ACCESS_KEY or "").strip()
        if key and secret:
            con.execute(f"SET s3_access_key_id='{key.replace(chr(39), chr(39)+chr(39))}'")
            con.execute(
                f"SET s3_secret_access_key='{secret.replace(chr(39), chr(39)+chr(39))}'"
            )

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
            cols = con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()
            count_row = con.execute(f"SELECT COUNT(*) FROM {src}").fetchone()
        except Exception as exc:
            self.logger.exception("DuckDB schema failed: %s", exc)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to read tabular schema",
            ) from exc
        finally:
            con.close()
        columns = [{"name": c[0], "type": c[1]} for c in cols]
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
            headers = [c[0] for c in con.execute(f"DESCRIBE SELECT * FROM {src}").fetchall()]
            rows = con.execute(
                f"SELECT * FROM {src} LIMIT {limit} OFFSET {offset}"
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
            sql = (
                f"SELECT {', '.join(select_parts)} FROM {src} "
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
