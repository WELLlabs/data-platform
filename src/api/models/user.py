from datetime import datetime
from typing import TYPE_CHECKING, Optional

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.sql import func

from .base import Base

if TYPE_CHECKING:
    from .user_contribution import UserContribution


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
    modified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True, onupdate=func.now()
    )
    verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    apikey: Mapped[str] = mapped_column(Text, nullable=False, unique=True)

    # One-to-one: contribution count lives in user_contributions table
    user_contribution: Mapped[Optional["UserContribution"]] = relationship(
        "UserContribution",
        back_populates="user",
        uselist=False,
        lazy="selectin",
    )

    @property
    def contributions(self) -> int:
        """Contribution count from user_contributions table (0 if no row)."""
        if self.user_contribution is None:
            return 0
        return self.user_contribution.contributions
