from datetime import datetime
from typing import Optional

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func

from .base import Base


class User(SQLAlchemyBaseUserTableUUID, Base):
    __tablename__ = "users"

    # Additional fields
    full_name: Mapped[str] = mapped_column(String(length=50), nullable=False)
    student: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    designation: Mapped[Optional[str]] = mapped_column(String(length=25), nullable=True)
    organization: Mapped[str] = mapped_column(String(length=50), nullable=False)
    role: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(length=20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    apikey: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    contributions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
