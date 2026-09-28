"""Visualization: /access_file, conversion status, DuckDB table/chart queries."""

from typing import List, Optional
from uuid import UUID

from db.session import get_session
from fastapi import APIRouter, Depends, Query, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from models.file import File
from models.user import User
from pydantic import BaseModel, Field
from routers.upload import (
    UploadController,
    get_current_user_optional_for_download,
    get_upload_controller,
)
from services.upload import UploadService, get_upload_service
from services.visualization import VisualizationService
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import optional_api_key

router = APIRouter()


class ChartYColumn(BaseModel):
    column: str = Field(..., min_length=1, max_length=120)
    aggregation: str = Field(default="sum", max_length=16)
    label: Optional[str] = Field(default=None, max_length=120)


class ChartRequest(BaseModel):
    file_id: UUID
    x_column: str = Field(..., min_length=1, max_length=120)
    y_columns: List[ChartYColumn] = Field(..., min_length=1, max_length=8)
    limit: int = Field(default=200, ge=1, le=500)


def get_visualization_service(
    session: AsyncSession = Depends(get_session),
    upload_service: UploadService = Depends(get_upload_service),
) -> VisualizationService:
    return VisualizationService(session, upload_service)


async def _file_for_access(
    file_id: UUID,
    apikey: Optional[str],
    user: Optional[User],
    controller: UploadController,
) -> File:
    file_record, _dataset, _key = await controller._accessible_file_for_read(
        file_id, apikey, user
    )
    return file_record


@router.get("/access_file")
async def access_file(
    file_id: UUID = Query(..., description="Native file ID"),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
    viz: VisualizationService = Depends(get_visualization_service),
) -> JSONResponse:
    """
    Return the cloud-native file for visualization.

    Does not increment download counts or write download logs. Uses
    file_access_log instead. Kicks off Celery conversion when needed.
    """
    file_record = await _file_for_access(file_id, apikey, user, controller)
    payload = await viz.access_file(file_record, user)
    return JSONResponse(content=jsonable_encoder(payload), status_code=status.HTTP_200_OK)


@router.get("/access_file/status")
async def access_file_status(
    file_id: UUID = Query(..., description="Native file ID"),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
    viz: VisualizationService = Depends(get_visualization_service),
) -> JSONResponse:
    """Poll conversion status for a visualization request."""
    file_record = await _file_for_access(file_id, apikey, user, controller)
    payload = await viz.conversion_status(file_record)
    return JSONResponse(content=jsonable_encoder(payload), status_code=status.HTTP_200_OK)


@router.get("/access_file/schema")
async def access_file_schema(
    file_id: UUID = Query(..., description="Native file ID"),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
    viz: VisualizationService = Depends(get_visualization_service),
) -> JSONResponse:
    file_record = await _file_for_access(file_id, apikey, user, controller)
    payload = await viz.table_schema(file_record)
    return JSONResponse(content=jsonable_encoder(payload), status_code=status.HTTP_200_OK)


@router.get("/access_file/table")
async def access_file_table(
    file_id: UUID = Query(..., description="Native file ID"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
    viz: VisualizationService = Depends(get_visualization_service),
) -> JSONResponse:
    file_record = await _file_for_access(file_id, apikey, user, controller)
    payload = await viz.table_rows(file_record, limit=limit, offset=offset)
    return JSONResponse(content=jsonable_encoder(payload), status_code=status.HTTP_200_OK)


@router.post("/access_file/chart")
async def access_file_chart(
    body: ChartRequest,
    apikey: Optional[str] = Depends(optional_api_key),
    user: Optional[User] = Depends(get_current_user_optional_for_download),
    controller: UploadController = Depends(get_upload_controller),
    viz: VisualizationService = Depends(get_visualization_service),
) -> JSONResponse:
    """Aggregate chart series on the server with DuckDB. No raw SQL is accepted."""
    file_record = await _file_for_access(body.file_id, apikey, user, controller)
    payload = await viz.chart_data(
        file_record,
        x_column=body.x_column,
        y_columns=[y.model_dump() if hasattr(y, "model_dump") else y.dict() for y in body.y_columns],
        limit=body.limit,
    )
    return JSONResponse(content=jsonable_encoder(payload), status_code=status.HTTP_200_OK)
