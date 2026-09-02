"""Homepage aggregate statistics with Redis-backed per-field caching."""

from __future__ import annotations

import json
import logging
from typing import Any, Awaitable, Callable, Optional

from core.config import settings
from db.session import get_session
from fastapi import Depends
from models.dataset import Dataset
from models.organization import Organization
from models.user import User
from models.user_contribution import UserContribution
from redis.asyncio import Redis
from schemas.stats import HomepageStatsResponse, TopContributorItem, TopOrganizationItem
from services.auth import get_redis
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

CACHE_KEY_TOTAL = "stats:total_open_datasets"
CACHE_KEY_CONTRIBUTORS = "stats:top_contributors"
CACHE_KEY_ORGANIZATIONS = "stats:top_organizations"


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
        """Count public approved datasets; cached under CACHE_KEY_TOTAL."""

        def deserialize(raw: Any) -> int:
            if isinstance(raw, bool):
                raise ValueError("unexpected bool")
            return int(raw)

        async def compute() -> int:
            stmt = (
                select(func.count())
                .select_from(Dataset)
                .where(
                    Dataset.availability == 0,
                    Dataset.approved.is_(True),
                )
            )
            result = await self.session.execute(stmt)
            return int(result.scalar_one())

        return await self._cached_or_compute(
            CACHE_KEY_TOTAL,
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
            stmt = (
                select(
                    UserContribution.user_id,
                    User.full_name,
                    UserContribution.contributions,
                )
                .join(User, User.id == UserContribution.user_id)
                .order_by(desc(UserContribution.contributions))
                .limit(self._limit)
            )
            result = await self.session.execute(stmt)
            rows = result.all()
            return [
                {
                    "user_id": row[0],
                    "full_name": row[1],
                    "contributions": row[2],
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
            sum_per_org = (
                select(
                    UserContribution.organization_id.label("org_id"),
                    func.sum(UserContribution.contributions).label("contrib_sum"),
                )
                .group_by(UserContribution.organization_id)
                .subquery()
            )
            stmt = (
                select(
                    sum_per_org.c.org_id,
                    Organization.name,
                    sum_per_org.c.contrib_sum,
                )
                .join(Organization, Organization.id == sum_per_org.c.org_id)
                .order_by(desc(sum_per_org.c.contrib_sum))
                .limit(self._limit)
            )
            result = await self.session.execute(stmt)
            rows = result.all()
            return [
                {
                    "organization_id": row[0],
                    "organization_name": row[1],
                    "contributions": int(row[2]),
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
        contributors = await self.get_top_contributors()
        organizations = await self.get_top_organizations()
        return HomepageStatsResponse(
            total_open_datasets=total,
            top_contributors=contributors,
            top_organizations=organizations,
        )


async def get_stats_service(
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> StatsService:
    """FastAPI dependency for StatsService."""
    return StatsService(session=session, redis=redis)
