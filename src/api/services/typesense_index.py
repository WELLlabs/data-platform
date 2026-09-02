"""Typesense collection sync and search (Postgres remains source of truth)."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional
from uuid import UUID

import httpx
from core.config import settings
from models.dataset import Dataset
from models.dataset_owner import DatasetOwner
from models.user import User
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

COLLECTION_SCHEMA = {
    "name": "",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "dataset_id", "type": "string", "facet": True},
        {"name": "file_id", "type": "string", "optional": True, "facet": True},
        {"name": "title", "type": "string"},
        {"name": "description", "type": "string", "optional": True},
        {"name": "tags", "type": "string[]", "facet": True, "optional": True},
        {"name": "organization_id", "type": "string", "facet": True},
        {"name": "availability", "type": "int32", "facet": True},
        {"name": "approved", "type": "bool"},
        {"name": "creator_id", "type": "string"},
        {"name": "owner_ids", "type": "string[]", "facet": True},
        {"name": "temporal_from", "type": "int64", "optional": True},
        {"name": "temporal_to", "type": "int64", "optional": True},
    ],
}


def typesense_enabled() -> bool:
    return bool(settings.TYPESENSE_HOST.strip() and settings.TYPESENSE_API_KEY.strip())


def _base_url() -> str:
    proto = settings.TYPESENSE_PROTOCOL.strip() or "http"
    return f"{proto}://{settings.TYPESENSE_HOST.strip()}:{int(settings.TYPESENSE_PORT)}"


def _headers() -> dict[str, str]:
    return {"X-TYPESENSE-API-KEY": settings.TYPESENSE_API_KEY.strip()}


def _doc_id_dataset(dataset_id: UUID) -> str:
    return f"d-{dataset_id}"


def _doc_id_file(file_id: UUID) -> str:
    return f"f-{file_id}"


def _ts(dt: Optional[datetime]) -> Optional[int]:
    if dt is None:
        return None
    return int(dt.timestamp())


async def ensure_collection() -> None:
    if not typesense_enabled():
        return
    name = settings.TYPESENSE_COLLECTION
    schema = dict(COLLECTION_SCHEMA)
    schema["name"] = name
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            get = await client.get(
                f"{_base_url()}/collections/{name}", headers=_headers()
            )
            if get.status_code == 200:
                return
            create = await client.post(
                f"{_base_url()}/collections", headers=_headers(), json=schema
            )
            if create.status_code not in (200, 201, 409):
                logger.warning(
                    "Typesense create collection failed: %s %s",
                    create.status_code,
                    create.text,
                )
    except Exception:
        logger.exception("Typesense ensure_collection failed")


async def _upsert(doc: dict[str, Any]) -> None:
    if not typesense_enabled():
        return
    name = settings.TYPESENSE_COLLECTION
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(
                f"{_base_url()}/collections/{name}/documents",
                headers=_headers(),
                params={"action": "upsert"},
                json=doc,
            )
            if resp.status_code >= 400:
                logger.warning(
                    "Typesense upsert failed: %s %s", resp.status_code, resp.text
                )
    except Exception:
        logger.exception("Typesense upsert failed for %s", doc.get("id"))


async def _delete_id(doc_id: str) -> None:
    if not typesense_enabled():
        return
    name = settings.TYPESENSE_COLLECTION
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.delete(
                f"{_base_url()}/collections/{name}/documents/{doc_id}",
                headers=_headers(),
            )
    except Exception:
        logger.exception("Typesense delete failed for %s", doc_id)


async def delete_dataset_documents(dataset_id: UUID) -> None:
    if not typesense_enabled():
        return
    name = settings.TYPESENSE_COLLECTION
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            await client.delete(
                f"{_base_url()}/collections/{name}/documents",
                headers=_headers(),
                params={"filter_by": f"dataset_id:={dataset_id}"},
            )
    except Exception:
        logger.exception("Typesense delete dataset docs failed for %s", dataset_id)


async def delete_file_document(file_id: UUID) -> None:
    await _delete_id(_doc_id_file(file_id))


async def index_dataset(session: AsyncSession, dataset_id: UUID) -> None:
    if not typesense_enabled():
        return
    result = await session.execute(
        select(Dataset)
        .options(selectinload(Dataset.tags), selectinload(Dataset.files))
        .where(Dataset.dataset_id == dataset_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        await delete_dataset_documents(dataset_id)
        return
    owners = await session.execute(
        select(DatasetOwner.user_id).where(DatasetOwner.dataset_id == dataset_id)
    )
    owner_ids = [str(row[0]) for row in owners.all()]
    tags = [t.tag_name for t in (dataset.tags or [])]
    desc = dataset.dataset_description or ""
    await _upsert(
        {
            "id": _doc_id_dataset(dataset.dataset_id),
            "dataset_id": str(dataset.dataset_id),
            "file_id": "",
            "title": dataset.dataset_title,
            "description": desc,
            "tags": tags,
            "organization_id": str(dataset.organization),
            "availability": int(dataset.availability),
            "approved": bool(dataset.approved),
            "creator_id": str(dataset.creator),
            "owner_ids": owner_ids,
        }
    )
    for f in dataset.files or []:
        context_parts = [
            f.file_description or "",
            f.file_format or "",
            f.provenance or "",
            f.source or "",
            f.geography or "",
        ]
        await _upsert(
            {
                "id": _doc_id_file(f.file_id),
                "dataset_id": str(dataset.dataset_id),
                "file_id": str(f.file_id),
                "title": f.file_title,
                "description": " ".join(p for p in context_parts if p),
                "tags": tags,
                "organization_id": str(dataset.organization),
                "availability": int(dataset.availability),
                "approved": bool(dataset.approved),
                "creator_id": str(dataset.creator),
                "owner_ids": owner_ids,
                "temporal_from": _ts(f.temporal_from),
                "temporal_to": _ts(f.temporal_to),
            }
        )


def typesense_filter_by(user: Optional[User], organization_id: Optional[str]) -> str:
    parts = ["approved:true"]
    if user is None:
        vis = "availability:=0"
    elif user.is_superuser:
        vis = "availability:>=0"
    else:
        clauses = [
            "availability:=0",
            f"creator_id:={user.id}",
            f"owner_ids:={user.id}",
            f"(availability:=2 && organization_id:={str(user.organization)})",
        ]
        if user.role == 1:
            clauses.append(
                f"(availability:=3 && organization_id:={str(user.organization)})"
            )
        vis = "(" + " || ".join(clauses) + ")"
    parts.append(vis)
    if organization_id and organization_id.strip():
        parts.append(f"organization_id:={organization_id.strip()}")
    return " && ".join(parts)


async def typesense_search(
    *,
    query: str,
    user: Optional[User],
    organization_id: Optional[str],
    start_date: Optional[datetime],
    end_date: Optional[datetime],
    tags: Optional[list[str]],
    limit: int,
    offset: int,
) -> Optional[tuple[list[dict[str, Any]], int, list[dict[str, Any]]]]:
    """Return (hits, total, tag_facets) or None if Typesense is unused/unavailable."""
    if not typesense_enabled():
        return None
    filter_by = typesense_filter_by(user, organization_id)
    extra_filters = []
    if start_date is not None:
        extra_filters.append(
            f"(file_id:='' || temporal_to:>={int(start_date.timestamp())})"
        )
    if end_date is not None:
        extra_filters.append(
            f"(file_id:='' || temporal_from:<={int(end_date.timestamp())})"
        )
    if extra_filters:
        filter_by += " && " + " && ".join(extra_filters)
    if tags:
        tag_clause = " || ".join(f"tags:={t}" for t in tags if t)
        if tag_clause:
            filter_by += f" && ({tag_clause})"

    params = {
        "q": query,
        "query_by": "title,description,tags",
        "filter_by": filter_by,
        "per_page": min(max(1, limit), 100),
        "page": max(1, (offset // max(limit, 1)) + 1) if limit else 1,
        "facet_by": "tags",
        "max_facet_values": 50,
    }
    # Typesense page is 1-based from offset/limit
    if limit > 0:
        params["page"] = (offset // limit) + 1
        params["per_page"] = limit
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{_base_url()}/collections/{settings.TYPESENSE_COLLECTION}/documents/search",
                headers=_headers(),
                params=params,
            )
        if resp.status_code >= 400:
            logger.warning("Typesense search failed: %s %s", resp.status_code, resp.text)
            return None
        data = resp.json()
        hits = []
        for hit in data.get("hits") or []:
            doc = hit.get("document") or {}
            hits.append(
                {
                    "dataset_id": doc.get("dataset_id") or "",
                    "file_id": doc.get("file_id") or "",
                    "title": doc.get("title") or "",
                    "context": doc.get("description") or "",
                    "score": float(hit.get("text_match") or 0),
                }
            )
        total = int(data.get("found") or 0)
        tag_facets: list[dict[str, Any]] = []
        for facet in data.get("facet_counts") or []:
            if facet.get("field_name") != "tags":
                continue
            for c in facet.get("counts") or []:
                tag_facets.append(
                    {"value": c.get("value") or "", "count": int(c.get("count") or 0)}
                )
        return hits, total, tag_facets
    except Exception:
        logger.exception("Typesense search request failed")
        return None


async def safe_index_dataset(session: AsyncSession, dataset_id: UUID) -> None:
    try:
        await index_dataset(session, dataset_id)
    except Exception:
        logger.exception("safe_index_dataset failed for %s", dataset_id)


async def safe_delete_dataset_documents(dataset_id: UUID) -> None:
    try:
        await delete_dataset_documents(dataset_id)
    except Exception:
        logger.exception("safe_delete_dataset_documents failed for %s", dataset_id)


async def safe_delete_file_document(file_id: UUID) -> None:
    try:
        await delete_file_document(file_id)
    except Exception:
        logger.exception("safe_delete_file_document failed for %s", file_id)
