from typing import AsyncGenerator

from core.config import settings
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def build_engine() -> AsyncEngine:
    return create_async_engine(settings.POSTGRES_URL, pool_pre_ping=True)


engine: AsyncEngine = build_engine()
SessionLocal = async_sessionmaker(
    bind=engine, expire_on_commit=False, class_=AsyncSession
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
