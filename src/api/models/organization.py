from datetime import datetime
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import ARRAY, Boolean, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        nullable=False,
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

    # Boolean fields
    private: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Array fields for multi-select options
    focus: Mapped[Optional[List[str]]] = mapped_column(ARRAY(String), nullable=True)
    roi_states: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String), nullable=True
    )
    allowed_email_domains: Mapped[Optional[List[str]]] = mapped_column(
        ARRAY(String), nullable=True
    )
    allow_password: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="true"
    )
    allow_google: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False, server_default="true"
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    modified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )
