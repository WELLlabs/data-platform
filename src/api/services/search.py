"""
Search service for full-text and trigram search over global_search_index.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from core.availability import search_visibility_sql
from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.dataset import Dataset
from models.user import User
from redis.asyncio import Redis
from schemas.search import SearchResultItem, SearchResponse, TagFacet
from services.dataset import DatasetService
from services.typesense_index import typesense_search
from services.auth import get_redis
from services.user import UserService, get_user_service
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

logger = logging.getLogger(__name__)

# Top 100 results cached per query when no filters are applied
SEARCH_CACHE_SIZE = 100


class SearchService:
    """
    Service for searching global_search_index with FTS and visibility rules.

    Applies same visibility as get_datasets: no apikey -> only public;
    with apikey -> public or same organization.
    Redis caches top 100 results (ZSET) per sanitized query when no filters
    are used, to avoid CPU-heavy trigram/FTS on repeated queries.
    """

    def __init__(
        self,
        session: AsyncSession,
        redis: Optional[Redis] = None,
        user_service: Optional[UserService] = None,
    ):
        self.session = session
        self.redis = redis
        self.user_service = user_service
        self.logger = logging.getLogger(__name__)

    def _cache_key(self, sanitized_query: str) -> str:
        """Key for ZSET of cached results: search:{sanitized_lowercase_query}."""
        return f"search:{sanitized_query.lower().strip()}"

    def _cache_total_key(self, sanitized_query: str) -> str:
        """Key for total count: search:{sanitized_lowercase_query}:total."""
        return f"{self._cache_key(sanitized_query)}:total"

    def _is_cacheable(
        self,
        organization_id: Optional[str],
        start_date: Optional[datetime],
        end_date: Optional[datetime],
        apikey: Optional[str],
        viewer_org: Optional[str] = None,
        tags: Optional[str] = None,
        topics: Optional[str] = None,
    ) -> bool:
        """Use cache only when no filters are applied."""
        if organization_id is not None and str(organization_id).strip():
            return False
        if start_date is not None or end_date is not None:
            return False
        if apikey is not None and str(apikey).strip():
            return False
        if viewer_org is not None and str(viewer_org).strip():
            return False
        if tags is not None and str(tags).strip():
            return False
        if topics is not None and str(topics).strip():
            return False
        return True

    def _cache_ttl_seconds(self) -> int:
        """TTL for search cache (SEARCH_CACHE_AGE_SECONDS from env; default 120)."""
        return settings.SEARCH_CACHE_AGE_SECONDS

    async def _get_cached(
        self,
        cache_key: str,
        total_key: str,
        offset: int,
        limit: int,
    ) -> Optional[SearchResponse]:
        """Return response from Redis if key exists (ZREVRANGE by offset/limit); else None."""
        if self.redis is None:
            return None
        try:
            total_raw = await self.redis.get(total_key)
            if total_raw is None:
                return None
            total = int(total_raw)
            start = offset
            end = offset + limit - 1
            members = await self.redis.zrevrange(cache_key, start, end)
            result = []
            for m in members:
                try:
                    result.append(SearchResultItem.model_validate_json(m))
                except Exception as e:
                    self.logger.warning("Invalid cached search item: %s", e)
            return SearchResponse(result=result, total=total)
        except Exception as e:
            self.logger.warning("Redis cache read failed: %s", e)
            return None

    async def _set_cache(
        self,
        cache_key: str,
        total_key: str,
        items: list[SearchResultItem],
        total: int,
    ) -> None:
        """Store top 100 results in ZSET with score = weighted rank; pipeline ZADD; set TTL."""
        if self.redis is None or not items:
            return
        ttl = self._cache_ttl_seconds()
        try:
            pipe = self.redis.pipeline()
            for item in items[:SEARCH_CACHE_SIZE]:
                pipe.zadd(cache_key, {item.model_dump_json(): item.score})
            pipe.set(total_key, str(total), ex=ttl)
            pipe.expire(cache_key, ttl)
            await pipe.execute()
        except Exception as e:
            self.logger.warning("Redis cache write failed: %s", e)

    async def _hydrate_results(
        self, items: list[SearchResultItem]
    ) -> list[SearchResultItem]:
        """Attach dataset list fields so search cards match dataset listings."""
        ids: list[UUID] = []
        for item in items:
            if not item.dataset_id:
                continue
            try:
                ids.append(UUID(str(item.dataset_id)))
            except (TypeError, ValueError):
                continue
        if not ids:
            return items
        result = await self.session.execute(
            select(Dataset)
            .options(selectinload(Dataset.tags))
            .where(Dataset.dataset_id.in_(ids))
        )
        datasets = list(result.scalars().all())
        payloads = await DatasetService(
            self.session, None, None, None
        ).list_item_payloads(datasets)
        by_id = {p["dataset_id"]: p for p in payloads}
        hydrated: list[SearchResultItem] = []
        for item in items:
            payload = by_id.get(item.dataset_id)
            if not payload:
                hydrated.append(item)
                continue
            org = payload.get("organization")
            hydrated.append(
                item.model_copy(
                    update={
                        "title": payload.get("dataset_title") or item.title,
                        "context": payload.get("dataset_description") or item.context or "",
                        "creator": str(payload.get("creator") or ""),
                        "creator_name": payload.get("creator_name") or "",
                        "created_at": payload.get("created_at"),
                        "organization": str(org) if org is not None else "",
                        "organization_name": payload.get("organization_name") or "",
                        "availability": payload.get("availability"),
                        "downloads": payload.get("downloads"),
                        "file_count": payload.get("file_count"),
                        "tags": payload.get("tags") or [],
                    }
                )
            )
        return hydrated

    async def search(
        self,
        query: str,
        organization_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 10,
        offset: int = 0,
        apikey: Optional[str] = None,
        viewer_org: Optional[str] = None,
        current_user: Optional[User] = None,
        tags: Optional[str] = None,
        topics: Optional[str] = None,
    ) -> SearchResponse:
        """
        Search global_search_index with FTS, optional filters, and visibility.
        """
        if not query or not query.strip():
            query = "*"

        cacheable = self._is_cacheable(
            organization_id, start_date, end_date, apikey, viewer_org, tags, topics
        )
        extra = {
            "current_user": current_user,
            "viewer_org": viewer_org,
            "tags": tags,
            "topics": topics,
        }
        if cacheable and offset < SEARCH_CACHE_SIZE:
            cache_key = self._cache_key(query)
            total_key = self._cache_total_key(query)
            cached = await self._get_cached(
                cache_key, total_key, offset, limit
            )
            if cached is not None:
                cached.result = await self._hydrate_results(cached.result)
                return cached
            response = await self._run_search(
                query=query,
                organization_id=organization_id,
                start_date=start_date,
                end_date=end_date,
                limit=SEARCH_CACHE_SIZE,
                offset=0,
                apikey=apikey,
                **extra,
            )
            response.result = await self._hydrate_results(response.result)
            await self._set_cache(
                cache_key, total_key, response.result, response.total
            )
            start = offset
            end = min(offset + limit, len(response.result))
            return SearchResponse(
                result=response.result[start:end],
                total=response.total,
                tag_facets=response.tag_facets,
                topic_facets=response.topic_facets,
            )

        response = await self._run_search(
            query=query,
            organization_id=organization_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset,
            apikey=apikey,
            **extra,
        )
        response.result = await self._hydrate_results(response.result)
        return response

    async def _run_search(
        self,
        query: str,
        organization_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 10,
        offset: int = 0,
        apikey: Optional[str] = None,
        viewer_org: Optional[str] = None,
        current_user: Optional[User] = None,
        tags: Optional[str] = None,
        topics: Optional[str] = None,
    ) -> SearchResponse:
        viewer = current_user
        if viewer is None and apikey and apikey.strip() and self.user_service is not None:
            viewer = await self.user_service.get_user_model_by_apikey(apikey.strip())
            if viewer is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Invalid API key",
                )

        tag_list = [
            t.strip()
            for t in (tags or "").split(",")
            if t and t.strip()
        ]
        topic_list = [
            t.strip()
            for t in (topics or "").split(",")
            if t and t.strip()
        ]
        ts = await typesense_search(
            query=query.strip(),
            user=viewer,
            organization_id=organization_id,
            start_date=start_date,
            end_date=end_date,
            tags=tag_list or None,
            topics=topic_list or None,
            limit=min(max(1, limit), 100),
            offset=max(0, offset),
        )
        if ts is not None:
            hits, total, facets, topic_facets = ts
            return SearchResponse(
                result=[
                    SearchResultItem(
                        dataset_id=h["dataset_id"],
                        file_id=h.get("file_id") or "",
                        title=h.get("title") or "",
                        context=h.get("context") or "",
                        score=float(h.get("score") or 0),
                    )
                    for h in hits
                ],
                total=total,
                tag_facets=[TagFacet(**f) for f in facets if f.get("value")],
                topic_facets=[TagFacet(**f) for f in topic_facets if f.get("value")],
            )

        has_org = organization_id is not None and bool(organization_id.strip())
        has_start = start_date is not None
        has_end = end_date is not None
        is_browse = query.strip() == "*"

        visibility_sql, vis_params = search_visibility_sql(viewer)
        org_filter = ""
        temporal_filter = ""
        if has_org:
            org_filter = "AND global_search_index.organization_id = :organization_id"
        if has_start:
            temporal_filter += (
                " AND (global_search_index.temporal_to IS NULL"
                " OR global_search_index.temporal_to >= :start_date_val)"
            )
        if has_end:
            temporal_filter += (
                " AND (global_search_index.temporal_from IS NULL"
                " OR global_search_index.temporal_from <= :end_date_val)"
            )

        params: dict = {
            "query": query.strip(),
            "organization_id": organization_id,
            "limit": min(max(1, limit), 100),
            "offset": max(0, offset),
            **vis_params,
        }
        if has_start:
            params["start_date_val"] = start_date
        if has_end:
            params["end_date_val"] = end_date

        if is_browse:
            match_clause = "TRUE"
            score_expr = "0"
        else:
            match_clause = (
                "(global_search_index.fts_vector @@ websearch_to_tsquery('english', :query)"
                " OR global_search_index.title % :query)"
            )
            score_expr = """
            (
                COALESCE(ts_rank(global_search_index.fts_vector, websearch_to_tsquery('english', :query)), 0) * 0.7
                + COALESCE(similarity(global_search_index.title, :query), 0) * 0.3
            )"""

        sql_from = f"""
        FROM global_search_index
        JOIN datasets d ON d.dataset_id = global_search_index.dataset_id
        WHERE {match_clause}
        AND {visibility_sql}
        {org_filter}
        {temporal_filter}
        """
        count_sql = text(
            "SELECT COUNT(DISTINCT global_search_index.dataset_id) AS total " + sql_from
        )
        select_sql = text(
            """
            SELECT dataset_id, file_id, title, context, score FROM (
                SELECT DISTINCT ON (global_search_index.dataset_id)
                    global_search_index.dataset_id,
                    CAST(NULL AS uuid) AS file_id,
                    COALESCE(d.dataset_title, global_search_index.title) AS title,
                    COALESCE(d.dataset_description, global_search_index.context) AS context,
                    """
            + score_expr
            + """ AS score
                """
            + sql_from
            + """
                ORDER BY global_search_index.dataset_id,
                    (global_search_index.file_id IS NULL) DESC,
                    """
            + score_expr
            + """ DESC
            ) ranked
            ORDER BY score DESC, title ASC
            LIMIT :limit OFFSET :offset
            """
        )

        try:
            count_result = await self.session.execute(count_sql, params)
            total = count_result.scalar() or 0
            if total == 0:
                return SearchResponse(result=[], total=0)

            result = await self.session.execute(select_sql, params)
            rows = result.mappings().all()
            result_list = [
                SearchResultItem(
                    dataset_id=str(row["dataset_id"]),
                    file_id="",
                    title=row["title"] or "",
                    context=row["context"] or "",
                    score=float(row["score"]) if row["score"] is not None else 0.0,
                )
                for row in rows
            ]
            return SearchResponse(result=result_list, total=total)
        except Exception as e:
            self.logger.exception("Search failed: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Search failed",
            ) from e


async def get_search_service(
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
    user_service: UserService = Depends(get_user_service),
) -> SearchService:
    """Dependency that returns SearchService."""
    return SearchService(
        session=session,
        redis=redis,
        user_service=user_service,
    )
