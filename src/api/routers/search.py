"""
Search router for full-text search over datasets and files.
"""

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from schemas.search import SearchResponse
from services.search import SearchService, get_search_service
from utils.security import sanitize_input

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/search", response_model=SearchResponse, tags=["Search"])
async def search(
    query: str = Query(..., description="Search keywords"),
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
    apikey: Optional[str] = Query(
        None,
        description="Optional API key for visibility (see datasets endpoint)",
    ),
    search_service: SearchService = Depends(get_search_service),
) -> SearchResponse:
    """
    Search datasets and files by keywords with optional filters.

    Uses the global_search_index (FTS + trigram). Visibility rules match the
    datasets endpoint: without apikey only public results; with valid apikey
    also includes results from the user's organization. Results are cached
    in Redis (top 100) when no filters are applied.

    Optional filters: organization_id, start_date, end_date (temporal overlap).
    """
    sanitized = sanitize_input(query)
    if not sanitized or not sanitized.strip():
        return SearchResponse(result=[], total=0)

    return await search_service.search(
        query=sanitized,
        organization_id=organization_id,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
        offset=offset,
        apikey=apikey,
    )
