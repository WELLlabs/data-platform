"""Many-to-many dataset owners. Creator remains on datasets.creator."""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy import DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class DatasetOwner(Base):
    __tablename__ = "dataset_owners"

    dataset_id: Mapped[UUID] = mapped_column(
        ForeignKey("datasets.dataset_id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
        index=True,
    )
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
        nullable=False,
        index=True,
    )
    added_by: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    def __repr__(self) -> str:
        return (
            f"<DatasetOwner(dataset_id={self.dataset_id}, user_id={self.user_id})>"
        )
