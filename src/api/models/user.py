from typing import Optional

from fastapi_users_db_sqlalchemy import SQLAlchemyBaseUserTableUUID
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column, declarative_base


Base = declarative_base()


class User(SQLAlchemyBaseUserTableUUID, Base):
  __tablename__ = "users"

  # Additional fields
  full_name: Mapped[Optional[str]] = mapped_column(String(length=255), nullable=True)


