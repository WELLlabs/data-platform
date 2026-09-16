"""Tag vocabulary listing and autocomplete."""

from __future__ import annotations

import logging
from typing import Any, Optional

from core.availability import AVAILABILITY_PUBLIC
from db.session import get_session
from fastapi import Depends
from models.dataset import Dataset
from models.tag import Tag
from models.tag_dataset import TagDataset
from services.typesense_index import (
    DEFAULT_TAG_TOPIC,
    tag_label_from_slug,
    typesense_suggest_tags,
)
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class TagService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.logger = logger

    async def suggest_tags(self, q: str, limit: int = 10) -> list[dict[str, Any]]:
        suggestions = await typesense_suggest_tags(q, limit=limit)
        if suggestions is not None:
            return suggestions
        return await self._suggest_from_postgres(q, limit)

    async def _suggest_from_postgres(
        self, q: str, limit: int
    ) -> list[dict[str, Any]]:
        query = select(Tag).order_by(Tag.tag_name)
        needle = (q or "").strip().lower()
        if needle:
            like = f"%{needle}%"
            query = query.where(func.lower(Tag.tag_name).like(like))
        query = query.limit(min(max(1, limit), 50))
        result = await self.session.execute(query)
        tags = list(result.scalars().all())
        return [
            {
                "tag": t.tag_name,
                "label": tag_label_from_slug(t.tag_name),
                "topic": t.topic or DEFAULT_TAG_TOPIC,
            }
            for t in tags
        ]

    async def list_topics(self) -> list[dict[str, Any]]:
        result = await self.session.execute(
            select(
                Tag.topic,
                func.count(func.distinct(Dataset.dataset_id)),
            )
            .select_from(Tag)
            .outerjoin(TagDataset, TagDataset.tag_id == Tag.tag_id)
            .outerjoin(
                Dataset,
                and_(
                    Dataset.dataset_id == TagDataset.dataset_id,
                    Dataset.approved.is_(True),
                    Dataset.availability == AVAILABILITY_PUBLIC,
                ),
            )
            .where(func.lower(Tag.topic) != DEFAULT_TAG_TOPIC.lower())
            .where(func.trim(Tag.topic) != "")
            .group_by(Tag.topic)
            .order_by(
                func.count(func.distinct(Dataset.dataset_id)).desc(),
                Tag.topic,
            )
        )
        return [
            {"topic": topic, "dataset_count": int(count or 0)}
            for topic, count in result.all()
        ]

    async def list_tags(
        self,
        topic: Optional[str] = None,
        limit: int = 200,
    ) -> list[dict[str, Any]]:
        query = (
            select(
                Tag.tag_name,
                Tag.topic,
                func.count(func.distinct(TagDataset.dataset_id)).label("dataset_count"),
            )
            .select_from(Tag)
            .outerjoin(TagDataset, TagDataset.tag_id == Tag.tag_id)
            .where(func.trim(Tag.tag_name) != "")
            .group_by(Tag.tag_name, Tag.topic)
            .order_by(
                func.count(func.distinct(TagDataset.dataset_id)).desc(),
                Tag.tag_name,
            )
            .limit(min(max(1, limit), 500))
        )
        topics = [
            t.strip()
            for t in (topic or "").split(",")
            if t and t.strip() and t.strip().upper() != DEFAULT_TAG_TOPIC
        ]
        if topics:
            query = query.where(func.lower(Tag.topic).in_([t.lower() for t in topics]))
        result = await self.session.execute(query)
        return [
            {
                "tag": name,
                "label": tag_label_from_slug(name),
                "topic": topic_name or DEFAULT_TAG_TOPIC,
                "dataset_count": int(count or 0),
            }
            for name, topic_name, count in result.all()
        ]


async def get_tag_service(
    session: AsyncSession = Depends(get_session),
) -> TagService:
    return TagService(session)
