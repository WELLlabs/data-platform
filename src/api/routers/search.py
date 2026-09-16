"""
Search router for full-text search over datasets and files.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from models.user import User
from routers.dataset import get_current_active_user_optional
from schemas.search import SearchResponse
from services.search import SearchService, get_search_service
from utils.security import optional_api_key, sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/search", response_model=SearchResponse, tags=["Search"])
async def search(
    query: str = Query(
        "",
        description="Search keywords; optional when tags or topics are set",
    ),
    organization_id: Optional[str] = Query(
        None,
        description="Filter by organization ID",
    ),
    start_date: Optional[datetime] = Query(
        None,
        description="Filter by temporal range start (TIMESTAMP)",
    ),
    end_date: Optional[datetime] = Query(
        None,
        description="Filter by temporal range end (TIMESTAMP)",
    ),
    limit: int = Query(10, ge=1, le=100, description="Maximum number of results"),
    offset: int = Query(0, ge=0, description="Number of results to skip"),
    apikey: Optional[str] = Depends(optional_api_key),
    current_user: Optional[User] = Depends(get_current_active_user_optional),
    tags: Optional[str] = Query(
        None,
        description="Comma-separated tag names to facet-filter",
    ),
    topics: Optional[str] = Query(
        None,
        description="Comma-separated topic names to facet-filter",
    ),
    search_service: SearchService = Depends(get_search_service),
) -> SearchResponse:
    """
    Search datasets and files by keywords with optional filters.

    Uses Typesense when `TYPESENSE_HOST` is set, otherwise PostgreSQL FTS on `global_search_index`. Visibility follows dataset availability (0–4). Tag facets are returned as `tag_facets`. Optional `tags` query param filters by tag names.
    """
    sanitized = (sanitize_input(query) or "").strip()
    return await search_service.search(
        query=sanitized or "*",
        organization_id=organization_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
        apikey=apikey,
        viewer_org=current_user.organization if current_user else None,
        current_user=current_user,
        tags=tags,
        topics=topics,
    )
