from __future__ import annotations

import logging
from typing import Any, Optional, Tuple
from uuid import UUID

from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, status
from fastapi_users.authentication import CookieTransport
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from models.user import User
from redis.asyncio import Redis
from schemas.user import UserCreate, UserRead
from services.organization import OrganizationService, get_organization_service
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from utils.security import generate_unique_api_key, sanitize_input


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
    def __init__(
        self,
        user_db: SQLAlchemyUserDatabase[User, UUID],
        redis: Redis,
        org_service: OrganizationService,
    ) -> None:
        self.user_db = user_db
        self.redis = redis
        self.org_service = org_service
        self.password_helper = PasswordHelper()
        self.logger = logging.getLogger(__name__)

        self.cookie_transport = CookieTransport(
            cookie_name=settings.COOKIE_NAME,
            cookie_max_age=settings.COOKIE_MAX_AGE_SECONDS,
            cookie_secure=False,
            cookie_httponly=True,
        )

    async def sign_in(
        self, email: str, password: str
    ) -> Tuple[Optional[User], Optional[dict[str, Any]]]:
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

    def _user_to_user_read(self, user: User) -> UserRead:
        """
        Convert User model to UserRead schema.

        Args:
            user: User model instance

        Returns:
            UserRead schema instance
        """
        return UserRead(
            id=user.id,
            email=user.email,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            is_verified=user.is_verified,
            full_name=user.full_name,
            student=user.student,
            designation=user.designation,
            team=user.team,
            organization=user.organization,
            role=user.role,
            bio=user.bio,
            phone=user.phone,
            created_at=user.created_at,
            verified=user.verified,
            apikey=user.apikey,
            contributions=user.contributions,
        )

    async def sign_up(self, user_data: UserCreate) -> User:
        """
        Create a new user with all required fields and generate a unique API key.

        Args:
            user_data: User creation data from request

        Returns:
            Created user object

        Raises:
            HTTPException: If user creation fails due to validation or database errors
        """
        try:
            # Log incoming request (exclude sensitive fields)
            self.logger.info(
                "Sign up attempt: email=%s, full_name=%s, student=%s, org=%s, role=%s",
                user_data.email,
                user_data.full_name,
                user_data.student,
                user_data.organization,
                user_data.role,
            )
            # Sanitize input data
            sanitized_data = {
                "full_name": sanitize_input(user_data.full_name),
                "designation": sanitize_input(user_data.designation),
                "team": sanitize_input(user_data.team),
                "organization": sanitize_input(user_data.organization),
                "bio": sanitize_input(user_data.bio),
            }

            # Validate required fields after sanitization
            if not sanitized_data["full_name"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Full name is required and cannot be empty",
                )
            if not sanitized_data["organization"]:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Organization is required and cannot be empty",
                )

            # Validate organization ID exists
            org_id = sanitized_data["organization"]
            if not await self.org_service.validate_organization_id(org_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Organisation ID is invalid",
                )

            # Hash password
            hashed_password = self.password_helper.hash(user_data.password)

            # Generate unique API key
            api_key = await generate_unique_api_key(self.user_db.session)

            # Build create dict for adapter (expects a mapping)
            create_dict = {
                "email": user_data.email,
                "hashed_password": hashed_password,
                "full_name": sanitized_data["full_name"],
                "student": user_data.student,
                "designation": sanitized_data["designation"],
                "team": sanitized_data["team"],
                "organization": sanitized_data["organization"],
                "role": user_data.role,
                "bio": sanitized_data["bio"],
                "phone": user_data.phone,
                "apikey": api_key,
                "is_active": True,
                "is_superuser": False,
                "is_verified": False,
                "verified": False,
                "contributions": 0,
            }

            user = await self.user_db.create(create_dict)
            self.logger.info(
                "User created successfully: user_id=%s email=%s", user.id, user.email
            )

            # Set user as creator of organization if organization doesn't have a creator yet
            try:
                await self.org_service.set_organization_creator(org_id, user.id)
                self.logger.info(
                    "Set user %s as creator of organization %s", user.id, org_id
                )
            except Exception as e:
                self.logger.warning(
                    "Failed to set creator for organization %s: %s", org_id, e
                )
                # Don't fail user creation if creator setting fails

            return user

        except IntegrityError as e:
            self.logger.exception("Integrity error during user creation: %s", e)
            error_str = str(e).lower()

            # Check for email constraint violation
            if "email" in error_str or "ix_users_email" in error_str:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="Email already exists. Please Sign In.",
                )
            # Check for apikey constraint violation
            elif (
                "apikey" in error_str
                or "unique constraint" in error_str
                and "apikey" in error_str
            ):
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail="API key conflict. Please try again.",
                )
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="User creation failed due to data validation error",
                )
        except Exception:
            self.logger.exception("Unexpected error during user creation")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error during user creation",
            )

    async def forgot_password(self, email: str) -> None:
        # Placeholder: in real app, send email with token
        _user = await self.user_db.get_by_email(email)
        return None


async def get_user_db(
    session: AsyncSession = Depends(get_session),
) -> SQLAlchemyUserDatabase[User, UUID]:
    yield SQLAlchemyUserDatabase(session, User)


async def get_auth_service(
    user_db: SQLAlchemyUserDatabase[User, UUID] = Depends(get_user_db),
    redis: Redis = Depends(get_redis),
    org_service: OrganizationService = Depends(get_organization_service),
) -> AuthService:
    return AuthService(user_db=user_db, redis=redis, org_service=org_service)
