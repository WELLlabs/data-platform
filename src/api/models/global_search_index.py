"""
Global search index model for full-text and trigram search.

This table aggregates searchable content from datasets and files.
It is maintained by PostgreSQL triggers on datasets and files tables.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, Index, Integer, Text
from sqlalchemy.dialects.postgresql import TSVECTOR, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base

logger = logging.getLogger(__name__)


class GlobalSearchIndex(Base):
    """
    Read-only search index populated by triggers.

    - Dataset rows: file_id is NULL; temporal_from/temporal_to are NULL;
      organization_id and availability from datasets.
    - File rows: file_id set; temporal_from/temporal_to from file;
      organization_id and availability from parent dataset.
    """

    __tablename__ = "global_search_index"
    __table_args__ = (
        Index(
            "uq_global_search_index_dataset_file",
            "dataset_id",
            "file_id",
            unique=True,
            postgresql_nulls_not_distinct=True,
        ),
        Index(
            "ix_global_search_index_fts_vector",
            "fts_vector",
            postgresql_using="gin",
        ),
        Index(
            "ix_global_search_index_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
    )

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
        nullable=False,
    )
    dataset_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    file_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=True,
        index=True,
    )
    title: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    context: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    fts_vector: Mapped[Optional[str]] = mapped_column(
        TSVECTOR(),
        nullable=True,
    )
    organization_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        nullable=False,
        index=True,
    )
    availability: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    temporal_from: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    temporal_to: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    def __repr__(self) -> str:
        """String representation of the GlobalSearchIndex model."""
        return (
            f"<GlobalSearchIndex(id={self.id}, dataset_id={self.dataset_id}, "
            f"file_id={self.file_id}, title={self.title!r})>"
        )
