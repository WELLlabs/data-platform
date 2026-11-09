"""Homepage aggregate statistics with Redis-backed per-field caching."""

from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Optional

from core.availability import AVAILABILITY_PUBLIC
from core.config import settings
from db.session import get_session
from fastapi import Depends
from models.dataset import Dataset
from models.file import File
from models.organization import Organization
from models.user import User
from redis.asyncio import Redis
from schemas.stats import HomepageStatsResponse, TopContributorItem, TopOrganizationItem
from services.auth import get_redis
from sqlalchemy import and_, case, desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

CACHE_KEY_TOTAL = "stats:total_datasets"
CACHE_KEY_FILE_SIZE = "stats:total_file_size"
CACHE_KEY_PUBLIC = "stats:total_public_datasets"
CACHE_KEY_ORG_COUNT = "stats:total_organizations"
CACHE_KEY_CONTRIBUTOR_COUNT = "stats:total_contributors"
CACHE_KEY_CONTRIBUTORS = "stats:top_contributors:v2"
CACHE_KEY_ORGANIZATIONS = "stats:top_organizations:v3"

ALL_CACHE_KEYS = (
    CACHE_KEY_TOTAL,
    CACHE_KEY_FILE_SIZE,
    CACHE_KEY_PUBLIC,
    CACHE_KEY_ORG_COUNT,
    CACHE_KEY_CONTRIBUTOR_COUNT,
    CACHE_KEY_CONTRIBUTORS,
    CACHE_KEY_ORGANIZATIONS,
)


def _is_open_dataset():
    """SQL condition for an open dataset: public availability and approved."""
    return and_(Dataset.availability == AVAILABILITY_PUBLIC, Dataset.approved.is_(True))


async def invalidate_homepage_stats_cache(redis: Optional[Redis] = None) -> None:
    """Drop every cached homepage stat so the next request recomputes from PostgreSQL.

    Called after dataset approval, rejection and deletion. Never raises: a Redis
    failure only means the cache expires on its normal TTL instead.
    """
    own_client = redis is None
    client = redis
    try:
        if own_client:
            client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
        await client.delete(*ALL_CACHE_KEYS)
    except Exception as e:
        logger.warning("Homepage stats cache invalidation failed: %s", e)
    finally:
        if own_client and client is not None:
            try:
                await client.aclose()
            except Exception:
                pass


class StatsService:
    """Loads homepage stats from Redis when present; otherwise computes from PostgreSQL."""

    def __init__(self, session: AsyncSession, redis: Redis) -> None:
        self.session = session
        self.redis = redis
        self._ttl = settings.HOMEPAGE_STATS_CACHE_AGE_SECONDS
        self._limit = settings.HOMEPAGE_STATS_RESULT_COUNT

    async def _redis_get_json(self, key: str) -> Optional[Any]:
        try:
            raw = await self.redis.get(key)
            if raw is None:
                return None
            return json.loads(raw)
        except Exception as e:
            logger.warning("Redis GET/parse failed for key=%s: %s", key, e)
            return None

    async def _redis_set_json(self, key: str, value: Any) -> None:
        try:
            payload = json.dumps(value, default=str)
            await self.redis.setex(key, self._ttl, payload)
        except Exception as e:
            logger.warning("Redis SET failed for key=%s: %s", key, e)

    async def _cached_or_compute(
        self,
        cache_key: str,
        compute: Callable[[], Awaitable[Any]],
        deserialize: Callable[[Any], Any],
    ) -> Any:
        cached = await self._redis_get_json(cache_key)
        if cached is not None:
            try:
                return deserialize(cached)
            except Exception as e:
                logger.warning(
                    "Invalid cached payload for key=%s: %s; recomputing",
                    cache_key,
                    e,
                )
        fresh = await compute()
        await self._redis_set_json(cache_key, fresh)
        return deserialize(fresh)

    async def get_total_open_datasets(self) -> int:
        """Count all datasets; cached under CACHE_KEY_TOTAL."""

        def deserialize(raw: Any) -> int:
            if isinstance(raw, bool):
                raise ValueError("unexpected bool")
            return int(raw)

        async def compute() -> int:
            stmt = select(func.count()).select_from(Dataset)
            result = await self.session.execute(stmt)
            return int(result.scalar_one())

        return await self._cached_or_compute(
            CACHE_KEY_TOTAL,
            compute,
            deserialize,
        )

    async def _cached_count(self, cache_key: str, stmt) -> int:
        def deserialize(raw: Any) -> int:
            if isinstance(raw, bool):
                raise ValueError("unexpected bool")
            return int(raw)

        async def compute() -> int:
            result = await self.session.execute(stmt)
            return int(result.scalar_one())

        return await self._cached_or_compute(cache_key, compute, deserialize)

    async def get_total_public_datasets(self) -> int:
        """Count open (public and approved) datasets across all organizations."""
        stmt = select(func.count()).select_from(Dataset).where(_is_open_dataset())
        return await self._cached_count(CACHE_KEY_PUBLIC, stmt)

    async def get_total_organizations(self) -> int:
        """Count organizations that have at least one dataset."""
        stmt = select(func.count(func.distinct(Dataset.organization)))
        return await self._cached_count(CACHE_KEY_ORG_COUNT, stmt)

    async def get_total_contributors(self) -> int:
        """Count users who have created at least one dataset."""
        stmt = select(func.count(func.distinct(Dataset.creator)))
        return await self._cached_count(CACHE_KEY_CONTRIBUTOR_COUNT, stmt)

    async def get_total_file_size(self) -> int:
        """Sum of all file sizes in bytes; cached under CACHE_KEY_FILE_SIZE."""

        def deserialize(raw: Any) -> int:
            if isinstance(raw, bool):
                raise ValueError("unexpected bool")
            return int(raw)

        async def compute() -> int:
            stmt = select(func.coalesce(func.sum(File.file_size), 0))
            result = await self.session.execute(stmt)
            return int(result.scalar_one())

        return await self._cached_or_compute(
            CACHE_KEY_FILE_SIZE,
            compute,
            deserialize,
        )

    async def get_top_contributors(self) -> list[TopContributorItem]:
        """Top users by contributions; cached under CACHE_KEY_CONTRIBUTORS."""

        def deserialize(raw: Any) -> list[TopContributorItem]:
            if not isinstance(raw, list):
                raise ValueError("expected list")
            return [TopContributorItem(**item) for item in raw]

        async def compute() -> list[dict[str, Any]]:
            # Rank contributors by the actual number of datasets each user has
            # submitted (counted from the datasets table), so the leaderboard
            # always reflects reality and includes everyone who has published.
            contrib_count = func.count(Dataset.dataset_id).label("contributions")
            stmt = (
                select(
                    Dataset.creator.label("user_id"),
                    User.full_name,
                    contrib_count,
                )
                .join(User, User.id == Dataset.creator)
                .group_by(Dataset.creator, User.full_name)
                .order_by(desc(contrib_count))
                .limit(self._limit)
            )
            result = await self.session.execute(stmt)
            rows = result.all()
            return [
                {
                    "user_id": row[0],
                    "full_name": row[1],
                    "contributions": int(row[2]),
                }
                for row in rows
            ]

        return await self._cached_or_compute(
            CACHE_KEY_CONTRIBUTORS,
            compute,
            deserialize,
        )

    async def get_top_organizations(self) -> list[TopOrganizationItem]:
        """Top organizations by summed contributions; cached under CACHE_KEY_ORGANIZATIONS."""

        def deserialize(raw: Any) -> list[TopOrganizationItem]:
            if not isinstance(raw, list):
                raise ValueError("expected list")
            return [TopOrganizationItem(**item) for item in raw]

        async def compute() -> list[dict[str, Any]]:
            # Rank organizations by the actual number of datasets published
            # under each org (counted from the datasets table).
            contrib_count = func.count(Dataset.dataset_id).label("contributions")
            open_count = func.coalesce(
                func.sum(case((_is_open_dataset(), 1), else_=0)), 0
            ).label("open_contributions")
            stmt = (
                select(
                    Dataset.organization.label("org_id"),
                    Organization.name,
                    contrib_count,
                    open_count,
                )
                .join(Organization, Organization.id == Dataset.organization)
                .group_by(Dataset.organization, Organization.name)
                .order_by(desc(contrib_count))
                .limit(self._limit)
            )
            result = await self.session.execute(stmt)
            rows = result.all()
            return [
                {
                    "organization_id": row[0],
                    "organization_name": row[1],
                    "contributions": int(row[2]),
                    "open_contributions": int(row[3]),
                }
                for row in rows
            ]

        return await self._cached_or_compute(
            CACHE_KEY_ORGANIZATIONS,
            compute,
            deserialize,
        )

    async def get_homepage_stats(self) -> HomepageStatsResponse:
        """Full homepage payload; each subsection uses its own Redis key when possible."""
        total = await self.get_total_open_datasets()
        total_public = await self.get_total_public_datasets()
        total_orgs = await self.get_total_organizations()
        total_contributors = await self.get_total_contributors()
        file_size = await self.get_total_file_size()
        contributors = await self.get_top_contributors()
        organizations = await self.get_top_organizations()
        return HomepageStatsResponse(
            total_open_datasets=total,
            total_public_datasets=total_public,
            total_organizations=total_orgs,
            total_contributors=total_contributors,
            total_file_size=file_size,
            top_contributors=contributors,
            top_organizations=organizations,
        )


async def get_stats_service(
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> StatsService:
    """FastAPI dependency for StatsService."""
    return StatsService(session=session, redis=redis)
