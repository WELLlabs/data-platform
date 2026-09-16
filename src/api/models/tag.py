"""
Tag model for dataset tagging functionality.

This model represents tags in the system with proper foreign key relationships
and security considerations to prevent SQL injection.
"""

import logging
from datetime import datetime
from uuid import UUID

from sqlalchemy import DateTime, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

logger = logging.getLogger(__name__)


class Tag(Base):
    """
    Tag model representing tags for datasets.

    This class uses SQLAlchemy's declarative style with proper type hints
    and foreign key constraints to ensure data integrity and prevent SQL injection.
    """

    __tablename__ = "tags"

    # Primary key
    tag_id: Mapped[UUID] = mapped_column(
        primary_key=True,
        nullable=False,
        index=True,
    )

    # Required fields
    tag_name: Mapped[str] = mapped_column(
        Text,
        unique=True,
        nullable=False,
        index=True,
    )
    topic: Mapped[str] = mapped_column(
        Text,
        nullable=False,
        server_default="NA",
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    datasets: Mapped[list["Dataset"]] = relationship(
        "Dataset",
        secondary="tag_dataset",
        back_populates="tags",
    )

    def __repr__(self) -> str:
        """String representation of the Tag model."""
        return (
            f"<Tag(tag_id={self.tag_id}, tag_name={self.tag_name}, "
            f"topic={self.topic})>"
        )

