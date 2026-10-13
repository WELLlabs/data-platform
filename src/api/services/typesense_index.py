"""Typesense collection sync and search (Postgres remains source of truth)."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timezone
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


def _safe_typesense_token(value: str) -> str:
    """Strip characters that can break Typesense filter_by quoting."""
    cleaned = "".join(ch for ch in str(value) if ch not in "`\\")
    return cleaned.strip()[:120]

COLLECTION_SCHEMA = {
    "name": "",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "dataset_id", "type": "string", "facet": True},
        {"name": "file_id", "type": "string", "optional": True, "facet": True},
        {"name": "title", "type": "string", "infix": True},
        {"name": "description", "type": "string", "optional": True, "infix": True},
        {"name": "dataset_title", "type": "string", "optional": True},
        {"name": "dataset_description", "type": "string", "optional": True},
        {"name": "tags", "type": "string[]", "facet": True, "optional": True, "infix": True},
        {"name": "topics", "type": "string[]", "facet": True, "optional": True, "infix": True},
        {"name": "file_name", "type": "string", "optional": True, "infix": True},
        {
            "name": "embedding",
            "type": "float[]",
            "optional": True,
            "embed": {
                "from": ["title", "description", "tags", "topics", "file_name"],
                "model_config": {"model_name": "ts/all-MiniLM-L12-v2"},
            },
        },
        {"name": "organization_id", "type": "string", "facet": True},
        {"name": "availability", "type": "int32", "facet": True},
        {"name": "approved", "type": "bool"},
        {"name": "creator_id", "type": "string"},
        {"name": "owner_ids", "type": "string[]", "facet": True},
        {"name": "temporal_from", "type": "int64", "optional": True},
        {"name": "temporal_to", "type": "int64", "optional": True},
    ],
}

TAGS_COLLECTION_SCHEMA = {
    "name": "",
    "fields": [
        {"name": "id", "type": "string"},
        {"name": "tag", "type": "string", "infix": True},
        {"name": "label", "type": "string", "infix": True},
        {"name": "topic", "type": "string", "facet": True},
    ],
}

DEFAULT_TAG_TOPIC = "NA"


def typesense_enabled() -> bool:
    return bool(settings.TYPESENSE_HOST.strip() and settings.TYPESENSE_API_KEY.strip())


def _base_url() -> str:
    proto = settings.TYPESENSE_PROTOCOL.strip() or "http"
    return f"{proto}://{settings.TYPESENSE_HOST.strip()}:{int(settings.TYPESENSE_PORT)}"


def _headers() -> dict[str, str]:
    return {"X-TYPESENSE-API-KEY": settings.TYPESENSE_API_KEY.strip()}


def tags_collection_name() -> str:
    return (settings.TYPESENSE_TAGS_COLLECTION or "tags").strip() or "tags"


def tag_label_from_slug(slug: str) -> str:
    return (slug or "").replace("-", " ").strip()


def tag_document(
    tag_id: UUID | str,
    tag_name: str,
    topic: Optional[str] = None,
    label: Optional[str] = None,
) -> dict[str, Any]:
    slug = (tag_name or "").strip()
    resolved_label = (label or "").strip() or tag_label_from_slug(slug)
    return {
        "id": str(tag_id),
        "tag": slug,
        "label": resolved_label,
        "topic": (topic or DEFAULT_TAG_TOPIC).strip() or DEFAULT_TAG_TOPIC,
    }


def _doc_id_dataset(dataset_id: UUID) -> str:
    return f"d-{dataset_id}"


def _doc_id_file(file_id: UUID) -> str:
    return f"f-{file_id}"


def _ts(value: Optional[datetime | date]) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return int(value.timestamp())
    if isinstance(value, date):
        return int(datetime(value.year, value.month, value.day, tzinfo=timezone.utc).timestamp())
    return None


def _file_display_name(file: Any) -> str:
    key = (getattr(file, "file_key", None) or "").strip()
    base = key.rsplit("/", 1)[-1] if key else ""
    return base or (getattr(file, "file_title", None) or "")


def _dataset_topics(tags: list[Any]) -> list[str]:
    seen: list[str] = []
    for tag in tags or []:
        topic = (getattr(tag, "topic", None) or "").strip()
        if not topic or topic.upper() == DEFAULT_TAG_TOPIC:
            continue
        if topic not in seen:
            seen.append(topic)
    return seen


def _schema_without_embedding() -> dict[str, Any]:
    schema = dict(COLLECTION_SCHEMA)
    schema["fields"] = [
        f for f in COLLECTION_SCHEMA["fields"] if f.get("name") != "embedding"
    ]
    return schema


async def _patch_missing_fields(client: httpx.AsyncClient, name: str, existing: dict) -> None:
    present = {f.get("name") for f in (existing.get("fields") or [])}
    for field in COLLECTION_SCHEMA["fields"]:
        fname = field.get("name")
        if not fname or fname == "id" or fname in present:
            continue
        patch = await client.patch(
            f"{_base_url()}/collections/{name}",
            headers=_headers(),
            json={"fields": [field]},
        )
        if patch.status_code >= 400:
            logger.warning(
                "Typesense add field %s failed: %s %s",
                field.get("name"),
                patch.status_code,
                patch.text[:400],
            )


async def ensure_collection() -> None:
    if not typesense_enabled():
        return
    name = settings.TYPESENSE_COLLECTION
    schema = dict(COLLECTION_SCHEMA)
    schema["name"] = name
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            get = await client.get(
                f"{_base_url()}/collections/{name}", headers=_headers()
            )
            if get.status_code == 200:
                await _patch_missing_fields(client, name, get.json())
                return
            create = await client.post(
                f"{_base_url()}/collections", headers=_headers(), json=schema
            )
            if create.status_code in (200, 201, 409):
                return
            logger.warning(
                "Typesense create collection failed: %s %s",
                create.status_code,
                create.text[:400],
            )
            fallback = _schema_without_embedding()
            fallback["name"] = name
            retry = await client.post(
                f"{_base_url()}/collections", headers=_headers(), json=fallback
            )
            if retry.status_code not in (200, 201, 409):
                logger.warning(
                    "Typesense create collection (no embedding) failed: %s %s",
                    retry.status_code,
                    retry.text[:400],
                )
    except Exception:
        logger.exception("Typesense ensure_collection failed")


async def ensure_tags_collection() -> None:
    if not typesense_enabled():
        return
    name = tags_collection_name()
    schema = dict(TAGS_COLLECTION_SCHEMA)
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
                    "Typesense create tags collection failed: %s %s",
                    create.status_code,
                    create.text,
                )
    except Exception:
        logger.exception("Typesense ensure_tags_collection failed")


async def upsert_tag_document(doc: dict[str, Any]) -> None:
    if not typesense_enabled():
        return
    name = tags_collection_name()
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
                    "Typesense tag upsert failed: %s %s",
                    resp.status_code,
                    resp.text,
                )
    except Exception:
        logger.exception("Typesense tag upsert failed for %s", doc.get("id"))


async def safe_upsert_tag(
    tag_id: UUID | str,
    tag_name: str,
    topic: Optional[str] = None,
) -> None:
    try:
        await upsert_tag_document(tag_document(tag_id, tag_name, topic))
    except Exception:
        logger.exception("safe_upsert_tag failed for %s", tag_id)


async def import_tag_documents(docs: list[dict[str, Any]]) -> None:
    if not typesense_enabled() or not docs:
        return
    name = tags_collection_name()
    body = "\n".join(json.dumps(doc, ensure_ascii=False) for doc in docs)
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{_base_url()}/collections/{name}/documents/import",
                headers={**_headers(), "Content-Type": "text/plain"},
                params={"action": "upsert"},
                content=body.encode("utf-8"),
            )
            if resp.status_code >= 400:
                logger.warning(
                    "Typesense tag import failed: %s %s",
                    resp.status_code,
                    resp.text[:500],
                )
    except Exception:
        logger.exception("Typesense tag import failed")


async def typesense_suggest_tags(
    q: str,
    limit: int = 10,
) -> Optional[list[dict[str, Any]]]:
    """Prefix search the tags collection. None if Typesense is unused/unavailable."""
    if not typesense_enabled():
        return None
    name = tags_collection_name()
    params = {
        "q": (q or "").strip() or "*",
        "query_by": "tag,label",
        "per_page": min(max(1, limit), 50),
        "facet_by": "topic",
        "prefix": "true",
        "num_typos": "2",
        "typo_tokens_threshold": "1",
    }
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                f"{_base_url()}/collections/{name}/documents/search",
                headers=_headers(),
                params=params,
            )
        if resp.status_code >= 400:
            logger.warning(
                "Typesense tag suggest failed: %s %s",
                resp.status_code,
                resp.text,
            )
            return None
        data = resp.json()
        suggestions = []
        for hit in data.get("hits") or []:
            doc = hit.get("document") or {}
            suggestions.append(
                {
                    "tag": doc.get("tag") or "",
                    "label": doc.get("label") or "",
                    "topic": doc.get("topic") or DEFAULT_TAG_TOPIC,
                }
            )
        return suggestions
    except Exception:
        logger.exception("Typesense tag suggest request failed")
        return None


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
    topics = _dataset_topics(dataset.tags or [])
    desc = dataset.dataset_description or ""
    file_names = [_file_display_name(f) for f in (dataset.files or [])]
    await _upsert(
        {
            "id": _doc_id_dataset(dataset.dataset_id),
            "dataset_id": str(dataset.dataset_id),
            "file_id": "",
            "title": dataset.dataset_title,
            "description": desc,
            "dataset_title": dataset.dataset_title,
            "dataset_description": desc,
            "tags": tags,
            "topics": topics,
            "file_name": " ".join(n for n in file_names if n),
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
                "dataset_title": dataset.dataset_title,
                "dataset_description": desc,
                "tags": tags,
                "topics": topics,
                "file_name": _file_display_name(f),
                "organization_id": str(dataset.organization),
                "availability": int(dataset.availability),
                "approved": bool(dataset.approved),
                "creator_id": str(dataset.creator),
                "owner_ids": owner_ids,
                "temporal_from": _ts(f.temporal_from),
                "temporal_to": _ts(f.temporal_to),
            }
        )


def _grouped_or_flat_hits(data: dict[str, Any]) -> list[dict[str, Any]]:
    """Prefer the dataset-level document in each Typesense group."""
    grouped = data.get("grouped_hits")
    if not grouped:
        return list(data.get("hits") or [])
    hits: list[dict[str, Any]] = []
    for group in grouped:
        group_hits = group.get("hits") or []
        chosen = None
        for hit in group_hits:
            file_id = (hit.get("document") or {}).get("file_id") or ""
            if not file_id:
                chosen = hit
                break
        if chosen is None and group_hits:
            chosen = group_hits[0]
        if chosen is not None:
            hits.append(chosen)
    return hits


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
    topics: Optional[list[str]] = None,
    limit: int,
    offset: int,
) -> Optional[tuple[list[dict[str, Any]], int, list[dict[str, Any]], list[dict[str, Any]]]]:
    """Return (hits, total, tag_facets, topic_facets) or None if Typesense is unused/unavailable."""
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
        safe_tags = [_safe_typesense_token(t) for t in (tags or []) if _safe_typesense_token(t)]
        safe_topics = [_safe_typesense_token(t) for t in (topics or []) if _safe_typesense_token(t)]
        if safe_tags:
            tag_clause = " || ".join(f"tags:=`{t}`" for t in safe_tags)
            filter_by += f" && ({tag_clause})"
        if safe_topics:
            topic_clause = " || ".join(f"topics:=`{t}`" for t in safe_topics)
            filter_by += f" && ({topic_clause})"

    keyword_by = "title,description,tags,topics,file_name"
    hybrid_by = f"{keyword_by},embedding"
    page = (offset // limit) + 1 if limit > 0 else 1
    q = (query or "").strip() or "*"
    base_params = {
        "q": q,
        "filter_by": filter_by,
        "per_page": min(max(1, limit), 100),
        "page": page,
        "facet_by": "tags,topics",
        "max_facet_values": 50,
        "prefix": "true",
        "num_typos": "2",
        "typo_tokens_threshold": "1",
        "drop_tokens_threshold": "1",
        "split_join_tokens": "fallback",
        "prioritize_exact_match": "true",
        "min_len_1typo": "3",
        "min_len_2typo": "6",
        "highlight_full_fields": "title,description,tags,topics,file_name",
        "query_by_weights": "4,3,3,3,2",
        # One result per dataset even when a file document also matches.
        "group_by": "dataset_id",
        "group_limit": 20,
    }

    async def _search(
        query_by: str, weights: str, grouped: bool = True
    ) -> Optional[httpx.Response]:
        params = dict(base_params)
        params["query_by"] = query_by
        params["query_by_weights"] = weights
        if not grouped:
            params.pop("group_by", None)
            params.pop("group_limit", None)
        async with httpx.AsyncClient(timeout=20.0) as client:
            return await client.get(
                f"{_base_url()}/collections/{settings.TYPESENSE_COLLECTION}/documents/search",
                headers=_headers(),
                params=params,
            )

    try:
        resp = None
        if q != "*":
            resp = await _search(hybrid_by, "4,3,3,3,2,1")
            if resp is not None and resp.status_code >= 400:
                logger.warning(
                    "Typesense hybrid search failed, retrying keyword: %s %s",
                    resp.status_code,
                    resp.text[:400],
                )
                resp = None
        if resp is None or resp.status_code >= 400:
            resp = await _search(keyword_by, "4,3,3,3,2")
        if resp is not None and resp.status_code >= 400 and "group_by" in (resp.text or ""):
            logger.warning(
                "Typesense grouped search failed, retrying ungrouped: %s %s",
                resp.status_code,
                resp.text[:400],
            )
            resp = await _search(keyword_by, "4,3,3,3,2", grouped=False)
        if resp is None or resp.status_code >= 400:
            if resp is not None:
                logger.warning("Typesense search failed: %s %s", resp.status_code, resp.text)
            return None
        data = resp.json()
        hits = []
        for hit in _grouped_or_flat_hits(data):
            doc = hit.get("document") or {}
            vector_dist = hit.get("vector_distance")
            text_match = float(hit.get("text_match") or 0)
            score = text_match
            if vector_dist is not None:
                try:
                    score = text_match + (1.0 - float(vector_dist)) * 1000
                except (TypeError, ValueError):
                    pass
            hits.append(
                {
                    "dataset_id": doc.get("dataset_id") or "",
                    "file_id": "",
                    "title": doc.get("dataset_title") or doc.get("title") or "",
                    "context": doc.get("dataset_description")
                    or doc.get("description")
                    or "",
                    "score": score,
                }
            )
        unique_hits: list[dict[str, Any]] = []
        seen_datasets: set[str] = set()
        for hit in hits:
            dataset_id = hit.get("dataset_id") or ""
            if not dataset_id or dataset_id in seen_datasets:
                continue
            seen_datasets.add(dataset_id)
            unique_hits.append(hit)
        hits = unique_hits
        total = int(data.get("found") or 0)
        tag_facets: list[dict[str, Any]] = []
        topic_facets: list[dict[str, Any]] = []
        for facet in data.get("facet_counts") or []:
            field = facet.get("field_name")
            bucket = tag_facets if field == "tags" else topic_facets if field == "topics" else None
            if bucket is None:
                continue
            for c in facet.get("counts") or []:
                bucket.append(
                    {"value": c.get("value") or "", "count": int(c.get("count") or 0)}
                )
        return hits, total, tag_facets, topic_facets
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
