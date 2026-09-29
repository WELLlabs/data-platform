"""Tag autocomplete endpoint backed by the Typesense tag_vocabulary collection.

Place this file in:  src/api/routers/tag_suggest.py

Then register it in main.py alongside the other routers, e.g.:
    from routers import tag_suggest
    app.include_router(tag_suggest.router)

It powers autocomplete for both the dataset tagging form and the search box.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import httpx
from core.config import settings
from fastapi import APIRouter, Query

router = APIRouter()
logger = logging.getLogger(__name__)

TAGS_COLLECTION = os.getenv("TYPESENSE_TAGS_COLLECTION", "tag_vocabulary")


def _base_url() -> str:
    proto = settings.TYPESENSE_PROTOCOL.strip() or "http"
    return f"{proto}://{settings.TYPESENSE_HOST.strip()}:{int(settings.TYPESENSE_PORT)}"


def _headers() -> dict[str, str]:
    return {"X-TYPESENSE-API-KEY": settings.TYPESENSE_API_KEY.strip()}


@router.get("/tags/suggest", tags=["Tags"])
async def suggest_tags(
    q: str = Query("", description="What the user has typed so far"),
    theme: Optional[str] = Query(
        None, description="Optional theme filter, e.g. Water, Land, Agriculture"
    ),
    limit: int = Query(10, ge=1, le=50),
) -> dict:
    """Return tag suggestions from the fixed vocabulary as the user types.

    Falls back to an empty list if Typesense is not configured, so the form
    still works (users just type freely).
    """
    if not (settings.TYPESENSE_HOST.strip() and settings.TYPESENSE_API_KEY.strip()):
        return {"suggestions": []}

    params = {
        "q": q or "*",
        "query_by": "tag,label",
        # prefix matching is on by default -> "wat" already matches "water".
        "per_page": limit,
        "facet_by": "theme",
    }
    if theme:
        params["filter_by"] = f"theme:={theme}"

    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_base_url()}/collections/{TAGS_COLLECTION}/documents/search",
                headers=_headers(),
                params=params,
            )
        if resp.status_code >= 400:
            logger.warning("Tag suggest failed: %s %s", resp.status_code, resp.text)
            return {"suggestions": []}
        data = resp.json()
        suggestions = [
            {
                "tag": (h.get("document") or {}).get("tag", ""),
                "label": (h.get("document") or {}).get("label", ""),
                "theme": (h.get("document") or {}).get("theme", ""),
            }
            for h in (data.get("hits") or [])
        ]
        return {"suggestions": suggestions}
    except Exception:
        logger.exception("Tag suggest request failed")
        return {"suggestions": []}
