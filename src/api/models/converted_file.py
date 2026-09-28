"""Models for cloud-native visualization derivatives and access logs."""

from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class ConvertedFile(Base):
    """Metadata for a cloud-native file derived from a native upload."""

    __tablename__ = "converted_files"

    cloud_file_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        default=uuid4,
        index=True,
    )
    native_file_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("files.file_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    bucket: Mapped[str] = mapped_column(Text, nullable=False)
    file_key: Mapped[str] = mapped_column(Text, nullable=False)
    format: Mapped[str] = mapped_column(String(length=50), nullable=False)
    created_on: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    last_accessed: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # processing | available | removed
    status: Mapped[str] = mapped_column(
        String(length=32),
        nullable=False,
        default="processing",
        server_default="processing",
        index=True,
    )


class FileAccessLog(Base):
    """One row per visualization access of a cloud-native (or native) file."""

    __tablename__ = "file_access_log"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        nullable=False,
        default=uuid4,
        index=True,
    )
    cloud_file_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("converted_files.cloud_file_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    native_file_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("files.file_id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    accessed_time: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    user_id: Mapped[Optional[UUID]] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
