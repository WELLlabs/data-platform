"""Synchronous SQLAlchemy session for Celery conversion workers."""

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from core.config import settings


def _sync_postgres_url() -> str:
    url = settings.POSTGRES_URL
    return url.replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)


sync_engine = create_engine(_sync_postgres_url(), pool_pre_ping=True)
SyncSession = sessionmaker(bind=sync_engine, expire_on_commit=False)
