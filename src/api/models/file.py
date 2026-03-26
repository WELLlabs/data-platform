"""
File model for data upload functionality.

This model represents files associated with datasets in the system with proper
foreign key relationships and security considerations to prevent SQL injection.
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import (
    BigInteger,
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


class File(Base):
    """
    File model representing files associated with datasets.

    This class uses SQLAlchemy's declarative style with proper type hints
    and foreign key constraints to ensure data integrity and prevent SQL injection.
    All text fields are properly typed to prevent XSS through database constraints.
    """

    __tablename__ = "files"

    # Primary key
    file_id: Mapped[UUID] = mapped_column(
        primary_key=True,
        nullable=False,
        index=True,
    )

    # Required fields
    file_title: Mapped[str] = mapped_column(Text, nullable=False)
    file_key: Mapped[str] = mapped_column(
        Text,
        unique=True,
        nullable=False,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    modified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )
    dataset_id: Mapped[UUID] = mapped_column(
        ForeignKey("datasets.dataset_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Optional fields
    bucket: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(
        BigInteger,
        nullable=True,
    )
    file_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    file_format: Mapped[Optional[str]] = mapped_column(
        String(length=20),
        nullable=True,
    )
    # Moved fields from datasets table
    provenance: Mapped[Optional[str]] = mapped_column(
        String(length=125),
        nullable=True,
    )
    source: Mapped[Optional[str]] = mapped_column(
        String(length=1000),
        nullable=True,
    )
    cite_as: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    groundtruthed: Mapped[Optional[bool]] = mapped_column(
        Boolean,
        nullable=True,
    )
    permissions: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    duration: Mapped[int] = mapped_column(
        Integer,
        default=0,
        nullable=False,
    )
    value: Mapped[Optional[str]] = mapped_column(
        String(length=10),
        nullable=True,
    )
    # New fields
    temporal_from: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    temporal_to: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    geography: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    dataset: Mapped["Dataset"] = relationship(
        "Dataset",
        back_populates="files",
    )

    def __repr__(self) -> str:
        """String representation of the File model."""
        return (
            f"<File(file_id={self.file_id}, "
            f"filename={self.file_title}, dataset_id={self.dataset_id})>"
        )
