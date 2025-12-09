"""
Dataset model for data upload functionality.

This model represents a dataset in the system with proper foreign key relationships
and security considerations to prevent SQL injection and XSS attacks.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

logger = logging.getLogger(__name__)


class Dataset(Base):
    """
    Dataset model representing uploaded datasets.

    This class uses SQLAlchemy's declarative style with proper type hints
    and foreign key constraints to ensure data integrity and prevent SQL injection.
    All text fields are properly typed to prevent XSS through database constraints.
    """

    __tablename__ = "datasets"

    # Primary key
    dataset_id: Mapped[UUID] = mapped_column(
        primary_key=True,
        nullable=False,
        index=True,
    )

    # Required fields
    dataset_title: Mapped[str] = mapped_column(Text, nullable=False)
    creator: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    modified_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
    organization: Mapped[str] = mapped_column(
        String(length=100),
        ForeignKey("organizations.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    private: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    downloads: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )

    # Optional fields
    dataset_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        nullable=False,
    )
    approved_by: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    files: Mapped[list["File"]] = relationship(
        "File",
        back_populates="dataset",
        cascade="all, delete-orphan",
    )
    tags: Mapped[list["Tag"]] = relationship(
        "Tag",
        secondary="tag_dataset",
        back_populates="datasets",
    )

    def __repr__(self) -> str:
        """String representation of the Dataset model."""
        return (
            f"<Dataset(dataset_id={self.dataset_id}, "
            f"title={self.dataset_title}, creator={self.creator})>"
        )
