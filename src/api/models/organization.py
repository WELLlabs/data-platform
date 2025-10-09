from datetime import datetime
from typing import List, Optional
from uuid import UUID

from sqlalchemy import ARRAY, Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class Organization(Base):
    __tablename__ = "organizations"

    # Primary key - alphanumerical ID generated from name
    id: Mapped[str] = mapped_column(
        String(length=100), primary_key=True, nullable=False
    )

    # Required fields
    name: Mapped[str] = mapped_column(String(length=100), nullable=False, unique=True)
    creator: Mapped[Optional[UUID]] = mapped_column(
        nullable=True
    )  # Will be set when first user signs up

    # Optional fields
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    org_type: Mapped[Optional[str]] = mapped_column(String(length=50), nullable=True)
    contact: Mapped[Optional[str]] = mapped_column(String(length=100), nullable=True)
    website: Mapped[Optional[str]] = mapped_column(String(length=200), nullable=True)

    # Numeric fields
    contributions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Boolean fields
    private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Array fields for multi-select options
    focus: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    roi_states: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String), nullable=True
    )

    # Timestamp
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
