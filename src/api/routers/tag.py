"""Tag suggest and topic listing endpoints."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, Query
from services.tag import TagService, get_tag_service

router = APIRouter()


@router.get("/tags/suggest", tags=["Tags"])
async def suggest_tags(
    q: str = Query("", description="What the user has typed so far"),
    limit: int = Query(10, ge=1, le=50),
    tag_service: TagService = Depends(get_tag_service),
) -> dict[str, Any]:
    suggestions = await tag_service.suggest_tags(q, limit=limit)
    return {"suggestions": suggestions}


@router.get("/tags", tags=["Tags"])
async def list_tags(
    topic: Optional[str] = Query(
        None, description="Optional comma-separated topic filter"
    ),
    limit: int = Query(200, ge=1, le=500),
    tag_service: TagService = Depends(get_tag_service),
) -> dict[str, Any]:
    tags = await tag_service.list_tags(topic=topic, limit=limit)
    return {"tags": tags}


@router.get("/topics", tags=["Tags"])
async def list_topics(
    tag_service: TagService = Depends(get_tag_service),
) -> dict[str, Any]:
    topics = await tag_service.list_topics()
    return {"topics": topics}
