"""
TagDataset association table model for many-to-many relationship between tags and datasets.

This model represents the association between tags and datasets in the system.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base

logger = logging.getLogger(__name__)


class TagDataset(Base):
    """
    TagDataset association table model.

    This class represents the many-to-many relationship between tags and datasets.
    """

    __tablename__ = "tag_dataset"

    # Composite primary key
    dataset_id: Mapped[UUID] = mapped_column(
        ForeignKey("datasets.dataset_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
        index=True,
    )
    tag_id: Mapped[UUID] = mapped_column(
        ForeignKey("tags.tag_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    modified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )

    def __repr__(self) -> str:
        """String representation of the TagDataset model."""
        return (
            f"<TagDataset(dataset_id={self.dataset_id}, "
            f"tag_id={self.tag_id})>"
        )

