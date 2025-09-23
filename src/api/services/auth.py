from __future__ import annotations

from datetime import timedelta
from typing import Any, Optional, Tuple

from fastapi import Depends
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import CookieTransport, AuthenticationBackend
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from sqlalchemy.ext.asyncio import AsyncSession
from redis.asyncio import Redis

from src.api.core.config import settings
from src.api.db.session import get_session
from src.api.models.user import User


class RedisStrategy:
    def __init__(self, redis: Redis, lifetime_seconds: int) -> None:
        self.redis = redis
        self.lifetime_seconds = lifetime_seconds

    async def write_token(self, token: str, user_id: str) -> None:
        await self.redis.setex(token, self.lifetime_seconds, user_id)

    async def read_token(self, token: str) -> Optional[str]:
        value = await self.redis.get(token)
        if value is None:
            return None
        return value.decode() if isinstance(value, (bytes, bytearray)) else str(value)

    async def destroy_token(self, token: str) -> None:
        await self.redis.delete(token)


async def get_redis() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)


class AuthService:
    def __init__(self, user_db: SQLAlchemyUserDatabase[User], redis: Redis) -> None:
        self.user_db = user_db
        self.redis = redis
        self.password_helper = PasswordHelper()

        self.cookie_transport = CookieTransport(
            cookie_name=settings.COOKIE_NAME,
            cookie_max_age=settings.COOKIE_MAX_AGE_SECONDS,
            cookie_secure=False,
            cookie_httponly=True,
        )

    async def sign_in(self, email: str, password: str) -> Tuple[Optional[User], Optional[dict[str, Any]]]:
        # Avoid timing attacks: always hash
        user = await self.user_db.get_by_email(email)
        if user is None:
            return None, None
        valid = self.password_helper.verify_and_update(password, user.hashed_password)
        if not valid[0]:
            return None, None
        # Simulate issuing a session token saved in redis
        token = f"session:{user.id}"
        strategy = RedisStrategy(self.redis, settings.COOKIE_MAX_AGE_SECONDS)
        await strategy.write_token(token, str(user.id))
        cookie = {
            "key": settings.COOKIE_NAME,
            "value": token,
            "max_age": settings.COOKIE_MAX_AGE_SECONDS,
            "httponly": True,
            "samesite": "lax",
        }
        return user, cookie

    async def sign_up(self, name: str, email: str, password: str) -> None:
        hashed_password = self.password_helper.hash(password)
        user = User(email=email, hashed_password=hashed_password, full_name=name, is_active=True, is_superuser=False)
        await self.user_db.create(user)

    async def forgot_password(self, email: str) -> None:
        # Placeholder: in real app, send email with token
        _user = await self.user_db.get_by_email(email)
        return None


async def get_user_db(session: AsyncSession = Depends(get_session)) -> SQLAlchemyUserDatabase[User]:
    yield SQLAlchemyUserDatabase(session, User)


async def get_auth_service(
    user_db: SQLAlchemyUserDatabase[User] = Depends(get_user_db),
    redis: Redis = Depends(get_redis),
) -> AuthService:
    return AuthService(user_db=user_db, redis=redis)


