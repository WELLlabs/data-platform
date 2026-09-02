"""
Search service for full-text and trigram search over global_search_index.
"""

import logging
from datetime import datetime
from typing import Optional

from core.availability import search_visibility_sql
from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from models.user import User
from redis.asyncio import Redis
from schemas.search import SearchResultItem, SearchResponse, TagFacet
from services.typesense_index import typesense_search
from services.auth import get_redis
from services.user import UserService, get_user_service
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

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
    ) -> bool:
        """Use cache only when no filters are applied."""
        if organization_id is not None and organization_id.strip():
            return False
        if start_date is not None or end_date is not None:
            return False
        if apikey is not None and apikey.strip():
            return False
        if viewer_org is not None and viewer_org.strip():
            return False
        if tags is not None and tags.strip():
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
    ) -> SearchResponse:
        """
        Search global_search_index with FTS, optional filters, and visibility.
        """
        if not query or not query.strip():
            return SearchResponse(result=[], total=0)

        cacheable = self._is_cacheable(
            organization_id, start_date, end_date, apikey, viewer_org, tags
        )
        extra = {"current_user": current_user, "viewer_org": viewer_org, "tags": tags}
        if cacheable and offset < SEARCH_CACHE_SIZE:
            cache_key = self._cache_key(query)
            total_key = self._cache_total_key(query)
            cached = await self._get_cached(
                cache_key, total_key, offset, limit
            )
            if cached is not None:
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
            await self._set_cache(
                cache_key, total_key, response.result, response.total
            )
            start = offset
            end = min(offset + limit, len(response.result))
            return SearchResponse(
                result=response.result[start:end],
                total=response.total,
            )

        return await self._run_search(
            query=query,
            organization_id=organization_id,
            start_date=start_date,
            end_date=end_date,
            limit=limit,
            offset=offset,
            apikey=apikey,
            **extra,
        )

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
    ) -> SearchResponse:
        """Execute search against Typesense, falling back to global_search_index."""
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
        ts = await typesense_search(
            query=query.strip(),
            user=viewer,
            organization_id=organization_id,
            start_date=start_date,
            end_date=end_date,
            tags=tag_list or None,
            limit=min(max(1, limit), 100),
            offset=max(0, offset),
        )
        if ts is not None:
            hits, total, facets = ts
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
            )

        has_org = organization_id is not None and bool(organization_id.strip())
        has_start = start_date is not None
        has_end = end_date is not None

        visibility_sql, vis_params = search_visibility_sql(viewer)
        org_filter = ""
        temporal_filter = ""
        if has_org:
            org_filter = "AND organization_id = :organization_id"
        if has_start:
            temporal_filter += " AND (temporal_to IS NULL OR temporal_to >= :start_date_val)"
        if has_end:
            temporal_filter += " AND (temporal_from IS NULL OR temporal_from <= :end_date_val)"

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

        # Keyword match (FTS) OR fuzzy match (trigram %); rank by weighted score
        match_clause = (
            "(fts_vector @@ websearch_to_tsquery('english', :query) OR title % :query)"
        )
        sql_base = f"""
        FROM global_search_index
        WHERE {match_clause}
        AND {visibility_sql}
        {org_filter}
        {temporal_filter}
        """
        count_sql = text("SELECT COUNT(*) AS total " + sql_base)
        score_expr = """
            (
                COALESCE(ts_rank(fts_vector, websearch_to_tsquery('english', :query)), 0) * 0.7
                + COALESCE(similarity(title, :query), 0) * 0.3
            )"""
        select_sql = text(
            """
            SELECT
                dataset_id,
                file_id,
                title,
                context,
                """
            + score_expr
            + """ AS score
            """
            + sql_base
            + """
            ORDER BY """
            + score_expr
            + """
            DESC
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
                    file_id=str(row["file_id"]) if row["file_id"] is not None else "",
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
