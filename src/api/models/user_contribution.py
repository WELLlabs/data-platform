"""User contribution model for per-user contribution counts."""

from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class UserContribution(Base):
    """One row per user: user_id, organization_id, and contribution count."""

    __tablename__ = "user_contributions"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        default=uuid4,
        nullable=False,
    )
    user_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    organization_id: Mapped[str] = mapped_column(
        String(length=50),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    contributions: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    user = relationship("User", back_populates="user_contribution", uselist=False)
