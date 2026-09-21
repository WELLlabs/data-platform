"""Tag vocabulary listing and autocomplete."""

from __future__ import annotations

import logging
from typing import Any, Optional

from core.availability import approved_dataset_visibility_clause
from db.session import get_session
from fastapi import Depends
from models.dataset import Dataset
from models.tag import Tag
from models.tag_dataset import TagDataset
from models.user import User
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

    def _visible_dataset_join(self, viewer: Optional[User]):
        return and_(
            Dataset.dataset_id == TagDataset.dataset_id,
            Dataset.approved.is_(True),
            approved_dataset_visibility_clause(viewer),
        )

    async def suggest_tags(
        self,
        q: str,
        limit: int = 10,
        viewer: Optional[User] = None,
    ) -> list[dict[str, Any]]:
        needle = (q or "").strip()
        if not needle:
            return await self._suggest_used_tags(viewer, limit)
        suggestions = await typesense_suggest_tags(q, limit=limit)
        if suggestions is not None:
            return suggestions
        return await self._suggest_from_postgres(q, limit)

    async def _suggest_used_tags(
        self, viewer: Optional[User], limit: int
    ) -> list[dict[str, Any]]:
        """Recently and frequently used tags on datasets the viewer may see."""
        visible = self._visible_dataset_join(viewer)
        query = (
            select(
                Tag.tag_name,
                Tag.topic,
                func.count(func.distinct(Dataset.dataset_id)).label("dataset_count"),
                func.max(TagDataset.created_at).label("last_used"),
            )
            .select_from(Tag)
            .join(TagDataset, TagDataset.tag_id == Tag.tag_id)
            .join(Dataset, visible)
            .where(func.trim(Tag.tag_name) != "")
            .group_by(Tag.tag_name, Tag.topic)
            .order_by(
                func.max(TagDataset.created_at).desc(),
                func.count(func.distinct(Dataset.dataset_id)).desc(),
                Tag.tag_name,
            )
            .limit(min(max(1, limit), 50))
        )
        result = await self.session.execute(query)
        return [
            {
                "tag": name,
                "label": tag_label_from_slug(name),
                "topic": topic_name or DEFAULT_TAG_TOPIC,
                "dataset_count": int(count or 0),
            }
            for name, topic_name, count, _last in result.all()
        ]

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

    async def list_topics(self, viewer: Optional[User] = None) -> list[dict[str, Any]]:
        visible = self._visible_dataset_join(viewer)
        result = await self.session.execute(
            select(
                Tag.topic,
                func.count(func.distinct(Dataset.dataset_id)),
            )
            .select_from(Tag)
            .join(TagDataset, TagDataset.tag_id == Tag.tag_id)
            .join(Dataset, visible)
            .where(func.lower(Tag.topic) != DEFAULT_TAG_TOPIC.lower())
            .where(func.trim(Tag.topic) != "")
            .group_by(Tag.topic)
            .having(func.count(func.distinct(Dataset.dataset_id)) > 0)
            .order_by(
                func.count(func.distinct(Dataset.dataset_id)).desc(),
                Tag.topic,
            )
        )
        return [
            {"topic": topic, "dataset_count": int(count or 0)}
            for topic, count in result.all()
            if int(count or 0) > 0
        ]

    async def list_tags(
        self,
        topic: Optional[str] = None,
        limit: int = 200,
        viewer: Optional[User] = None,
    ) -> list[dict[str, Any]]:
        visible = self._visible_dataset_join(viewer)
        query = (
            select(
                Tag.tag_name,
                Tag.topic,
                func.count(func.distinct(Dataset.dataset_id)).label("dataset_count"),
            )
            .select_from(Tag)
            .join(TagDataset, TagDataset.tag_id == Tag.tag_id)
            .join(Dataset, visible)
            .where(func.trim(Tag.tag_name) != "")
            .group_by(Tag.tag_name, Tag.topic)
            .having(func.count(func.distinct(Dataset.dataset_id)) > 0)
            .order_by(
                func.count(func.distinct(Dataset.dataset_id)).desc(),
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
            if int(count or 0) > 0
        ]


async def get_tag_service(
    session: AsyncSession = Depends(get_session),
) -> TagService:
    return TagService(session)
