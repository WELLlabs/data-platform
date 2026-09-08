from __future__ import annotations

import logging
from typing import Any, Optional, Tuple
from urllib.parse import quote, unquote
from uuid import UUID

from core.config import settings
from db.session import get_session
from fastapi import Depends, HTTPException, Request, status
from fastapi_users import BaseUserManager, FastAPIUsers
from fastapi_users.authentication import CookieTransport
from fastapi_users.password import PasswordHelper
from fastapi_users_db_sqlalchemy import SQLAlchemyUserDatabase
from models.user import User
from models.user_contribution import UserContribution
from redis.asyncio import Redis
from schemas.user import CompleteProfileUpdate, UserCreate, UserRead
from services.organization import OrganizationService, get_organization_service
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.email import (
    send_forgot_password_email,
    send_user_approval_request,
    send_verify_email,
)
from utils.security import (
    email_matches_allowed_domain,
    generate_session_token,
    generate_unique_api_key,
    is_profile_complete,
    sanitize_input,
)


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


async def get_upload_jobs_redis() -> Redis:
    """Redis client for upload job keys (UPLOAD_JOBS_BACKEND). Not session/cache REDIS_URL."""
    return Redis.from_url(settings.UPLOAD_JOBS_BACKEND, decode_responses=True)


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
        cookie = await self.issue_session_cookie(user)
        return user, cookie

    async def user_to_user_read(self, user: User) -> UserRead:
        """
        Convert User model to UserRead schema.
        Contributions are read from user_contributions table by user_id.

        Args:
            user: User model instance

        Returns:
            UserRead schema instance
        """
        result = await self.user_db.session.execute(
            select(UserContribution).where(UserContribution.user_id == user.id)
        )
        uc = result.scalar_one_or_none()
        contributions = uc.contributions if uc else 0
        return UserRead(
            id=user.id,
            email=user.email,
            is_active=user.is_active,
            is_superuser=user.is_superuser,
            is_verified=user.is_verified,
            full_name=user.full_name,
            designation=user.designation,
            organization=user.organization,
            role=user.role,
            phone=user.phone,
            created_at=user.created_at,
            verified=user.verified,
            contributions=contributions,
            auth_provider=getattr(user, "auth_provider", None) or "password",
            profile_complete=is_profile_complete(user),
        )

    async def issue_session_cookie(self, user: User) -> dict[str, Any]:
        token = f"session:{generate_session_token()}"
        strategy = RedisStrategy(self.redis, settings.COOKIE_MAX_AGE_SECONDS)
        await strategy.write_token(token, str(user.id))
        return {
            "key": settings.COOKIE_NAME,
            "value": token,
            "max_age": settings.COOKIE_MAX_AGE_SECONDS,
            "httponly": True,
            "samesite": "lax",
        }

    async def count_users(self) -> int:
        result = await self.user_db.session.execute(select(func.count()).select_from(User))
        return int(result.scalar_one() or 0)

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
                "Sign up attempt: email=%s, full_name=%s, org=%s, role=%s",
                user_data.email,
                user_data.full_name,
                user_data.organization,
                user_data.role,
            )
            if not email_matches_allowed_domain(
                user_data.email, settings.ALLOWED_EMAIL_DOMAIN
            ):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email domain is not allowed",
                )
            # Sanitize string fields only. organization is a UUID, not HTML text.
            sanitized_data = {
                "full_name": sanitize_input(user_data.full_name),
                "designation": sanitize_input(user_data.designation),
                "organization": user_data.organization,
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
            is_first_user = await self.count_users() == 0
            create_dict = {
                "email": user_data.email,
                "hashed_password": hashed_password,
                "full_name": sanitized_data["full_name"],
                "designation": sanitized_data["designation"],
                "organization": sanitized_data["organization"],
                "role": user_data.role,
                "phone": str(user_data.phone) if user_data.phone is not None else None,
                "apikey": api_key,
                "auth_provider": "password",
                "is_active": True,
                "is_superuser": is_first_user,
                "is_verified": False,
                "verified": False,
            }

            user = await self.user_db.create(create_dict)
            self.logger.info(
                "User created successfully: user_id=%s email=%s", user.id, user.email
            )

            # Create user_contributions row for the new user (same session; rollback on failure)
            try:
                uc = UserContribution(
                    user_id=user.id,
                    organization_id=user.organization,
                    contributions=0,
                )
                self.user_db.session.add(uc)
                await self.user_db.session.flush()
                await self.user_db.session.commit()
            except IntegrityError as e:
                self.logger.exception(
                    "UserContribution insert failed for user_id=%s: %s", user.id, e
                )
                await self.user_db.session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create user contribution record",
                ) from e
            except Exception as e:
                self.logger.exception(
                    "UserContribution insert failed for user_id=%s: %s", user.id, e
                )
                await self.user_db.session.rollback()
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="Failed to create user contribution record",
                ) from e

            # Set user as creator of organization if organization doesn't have a creator yet
            try:
                creator_set = await self.org_service.set_organization_creator(
                    org_id, user.id
                )
                if creator_set:
                    # Update user role to 1 (creator/admin) and mark as verified since they became the organization creator
                    user = await self.user_db.update(user, {"role": 1, "verified": True})
                    self.logger.info(
                        "Set user %s as creator of organization %s, updated role to 1, and marked as verified",
                        user.id,
                        org_id,
                    )
                else:
                    self.logger.info(
                        "Organization %s already has a creator, user %s role remains %s and verified remains %s",
                        org_id,
                        user.id,
                        user.role,
                        user.verified,
                    )
            except Exception as e:
                self.logger.warning(
                    "Failed to set creator for organization %s: %s", org_id, e
                )
                # Don't fail user creation if creator setting fails

            # Trigger verification email via UserManager's on_after_register hook
            # This queues the Celery task to send verification email
            # Skip if user is already verified (e.g., organization creator)
            if not user.verified:
                try:
                    user_manager = UserManager(self.user_db)
                    await user_manager.on_after_register(user, request=None)
                    self.logger.info(
                        "Triggered verification email for user_id=%s", user.id
                    )
                except Exception as email_error:
                    # Don't fail user creation if email sending fails
                    # The email task will be retried automatically by Celery
                    self.logger.error(
                        "Failed to trigger verification email for user_id=%s: %s. "
                        "User was created successfully but email may not be sent.",
                        user.id,
                        email_error,
                        exc_info=True,
                    )

                # Notify organization admins that a new user approval is pending
                try:
                    admin_email_result = await self.user_db.session.execute(
                        select(User.email).where(
                            User.organization == user.organization,
                            User.role == 1,
                            User.id != user.id,
                        )
                    )
                    admin_emails = admin_email_result.scalars().all()

                    if not admin_emails:
                        self.logger.info(
                            "No organization admins found for approval notification "
                            "for user_id=%s org_id=%s",
                            user.id,
                            user.organization,
                        )
                    else:
                        for admin_email in admin_emails:
                            send_user_approval_request.apply_async(
                                args=[admin_email, user.full_name],
                                queue="email",
                            )
                        self.logger.info(
                            "Queued user approval request emails for user_id=%s to %d admins",
                            user.id,
                            len(admin_emails),
                        )
                except Exception as approval_email_error:
                    self.logger.error(
                        "Failed to queue user approval request emails for user_id=%s: %s. "
                        "User was created successfully but admin notifications may not be sent.",
                        user.id,
                        approval_email_error,
                        exc_info=True,
                    )
            else:
                self.logger.info(
                    "Skipping verification and user approval request emails for user_id=%s "
                    "(already verified as organization creator)",
                    user.id,
                )

            return user

        except HTTPException:
            raise
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

    async def get_or_create_google_user(
        self, email: str, full_name: Optional[str]
    ) -> User:
        if not email_matches_allowed_domain(email, settings.ALLOWED_EMAIL_DOMAIN):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email domain is not allowed",
            )
        existing = await self.user_db.get_by_email(email)
        if existing:
            return existing
        import secrets as _secrets

        is_first_user = await self.count_users() == 0
        api_key = await generate_unique_api_key(self.user_db.session)
        name = sanitize_input(full_name) if full_name else None
        if not name:
            name = email.split("@")[0][:50]
        hashed_password = self.password_helper.hash(_secrets.token_urlsafe(32))
        create_dict = {
            "email": email,
            "hashed_password": hashed_password,
            "full_name": name[:50],
            "designation": None,
            "organization": None,
            "role": 0,
            "phone": None,
            "apikey": api_key,
            "auth_provider": "google",
            "is_active": True,
            "is_superuser": is_first_user,
            "is_verified": True,
            "verified": False,
        }
        user = await self.user_db.create(create_dict)
        self.logger.info("Google user created: user_id=%s email=%s", user.id, user.email)
        return user

    async def complete_profile(
        self, user: User, payload: CompleteProfileUpdate
    ) -> User:
        sanitized_name = sanitize_input(payload.full_name)
        sanitized_org = payload.organization
        if not sanitized_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Full name is required and cannot be empty",
            )
        if not await self.org_service.validate_organization_id(sanitized_org):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organisation ID is invalid",
            )
        designation = sanitize_input(payload.designation)
        phone = str(payload.phone) if payload.phone is not None else None
        user = await self.user_db.update(
            user,
            {
                "full_name": sanitized_name,
                "organization": sanitized_org,
                "designation": designation,
                "phone": phone,
            },
        )
        try:
            uc_result = await self.user_db.session.execute(
                select(UserContribution).where(UserContribution.user_id == user.id)
            )
            if uc_result.scalar_one_or_none() is None:
                self.user_db.session.add(
                    UserContribution(
                        user_id=user.id,
                        organization_id=sanitized_org,
                        contributions=0,
                    )
                )
                await self.user_db.session.flush()
                await self.user_db.session.commit()
        except IntegrityError:
            await self.user_db.session.rollback()
        try:
            creator_set = await self.org_service.set_organization_creator(
                sanitized_org, user.id
            )
            if creator_set:
                user = await self.user_db.update(
                    user, {"role": 1, "verified": True}
                )
            elif not user.verified:
                try:
                    admin_email_result = await self.user_db.session.execute(
                        select(User.email).where(
                            User.organization == sanitized_org,
                            User.role == 1,
                            User.id != user.id,
                        )
                    )
                    for admin_email in admin_email_result.scalars().all():
                        send_user_approval_request.apply_async(
                            args=[admin_email, user.full_name],
                            queue="email",
                        )
                except Exception as notify_error:
                    self.logger.warning(
                        "Failed to notify org admins after profile complete: %s",
                        notify_error,
                    )
        except Exception as e:
            self.logger.warning(
                "Failed to set creator for organization %s: %s", sanitized_org, e
            )
        return user

    async def forgot_password(self, email: str) -> None:
        # Placeholder: in real app, send email with token
        _user = await self.user_db.get_by_email(email)
        return None

    async def change_password(
        self,
        user_id: UUID,
        current_password: str,
        new_password: str,
        *,
        session_token: str,
    ) -> None:
        """
        Change user password after verifying current password.

        Requires the current session token so that this session can be invalidated
        after a successful password change (user must sign in again).

        Args:
            user_id: User's UUID
            current_password: User's current password
            new_password: User's new password
            session_token: Session token from the request cookie; this session is
                invalidated after password change so the user must sign in again.

        Raises:
            HTTPException: If user not found, current password incorrect, or validation fails
        """
        try:
            # Get user from database
            user = await self.user_db.get(user_id)
            if not user:
                self.logger.warning(
                    "Password change attempt for non-existent user: %s", user_id
                )
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
                )

            # Validate new password is not empty
            if not new_password or not new_password.strip():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="New password cannot be empty",
                )

            # Verify current password
            valid = self.password_helper.verify_and_update(
                current_password, user.hashed_password
            )
            if not valid[0]:
                self.logger.warning(
                    "Password change failed: incorrect current password for user_id=%s",
                    user_id,
                )
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Current password is incorrect",
                )

            # Validate new password is different from current password
            if current_password == new_password:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="New password must be different from current password",
                )

            # Hash new password
            hashed_password = self.password_helper.hash(new_password)

            # Update user password
            await self.user_db.update(user, {"hashed_password": hashed_password})

            # Invalidate the current session so the user must sign in again with the new password
            try:
                strategy = RedisStrategy(
                    self.redis, settings.COOKIE_MAX_AGE_SECONDS
                )
                await strategy.destroy_token(session_token)
            except Exception as redis_err:
                self.logger.warning(
                    "Failed to invalidate session for user_id=%s after password change: %s",
                    user_id,
                    redis_err,
                )
                # Password is changed; session will eventually expire

            self.logger.info("Password changed successfully for user_id=%s", user_id)

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error during password change: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal server error during password change",
            )


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


class UserManager(BaseUserManager[User, UUID]):
    """
    Custom UserManager for fastapi-users with email hooks for password reset and verification.
    """

    reset_password_token_secret = settings.SECRET
    reset_password_token_lifetime_seconds = settings.LONG_TOKEN_AGE_SECONDS
    verification_token_secret = settings.SECRET
    verification_token_lifetime_seconds = settings.LONG_TOKEN_AGE_SECONDS

    def __init__(self, user_db: SQLAlchemyUserDatabase[User, UUID]):
        super().__init__(user_db)
        self.logger = logging.getLogger(__name__)

    def parse_id(self, value: str) -> UUID:
        """
        Parse user ID from string to UUID.

        This method is required by fastapi-users BaseUserManager when using UUID as the ID type.
        It converts the user_id string from tokens to UUID format.

        Args:
            value: User ID as string

        Returns:
            UUID instance

        Raises:
            ValueError: If the string is not a valid UUID
        """
        try:
            return UUID(value)
        except ValueError as e:
            raise ValueError(f"Invalid UUID format: {value}") from e

    async def on_after_forgot_password(
        self, user: User, token: str, request: Optional[Request] = None
    ) -> None:
        """
        Hook called after forgot password token is generated.
        Queues Celery task to send forgot password email.

        Args:
            user: User instance
            token: Generated reset token (raw token string)
            request: Optional FastAPI request object
        """
        self.logger.info("Forgot password requested for user_id=%s", user.id)
        self.logger.debug(
            "Generated reset password token for user_id=%s (token length: %d)",
            user.id,
            len(token),
        )

        # URL-encode the token to handle special characters in JWT tokens
        encoded_token = quote(token, safe="")
        reset_link = f"{settings.DOMAIN}/reset-password?token={encoded_token}"

        self.logger.debug(
            "Constructed reset link for user_id=%s (link length: %d)",
            user.id,
            len(reset_link),
        )

        # Queue Celery task to send email
        send_forgot_password_email.apply_async(
            args=[user.email, user.full_name, reset_link],
            queue="email",
        )

        self.logger.info(
            "Queued forgot password email task for user_id=%s",
            user.id,
        )

    async def on_after_register(
        self, user: User, request: Optional[Request] = None
    ) -> None:
        """
        Hook called after user registration.
        Generates verification token and queues Celery task to send verification email.

        Args:
            user: User instance
            request: Optional FastAPI request object
        """
        from fastapi_users.jwt import generate_jwt

        self.logger.info("User registered: user_id=%s", user.id)

        # Generate verification token using fastapi-users' generate_jwt function
        # This ensures compatibility with the library's verification method
        # Token structure matches BaseUserManager.request_verify() implementation:
        # - sub: user ID as string
        # - email: user email (required by fastapi-users verify method)
        # - aud: verification token audience (defaults to "fastapi-users:verify")
        # - exp: expiration timestamp (automatically added by generate_jwt)
        token_data = {
            "sub": str(user.id),
            "email": user.email,
            "aud": self.verification_token_audience,
        }

        token = generate_jwt(
            token_data,
            self.verification_token_secret,
            self.verification_token_lifetime_seconds,
        )

        # URL-encode the token to handle special characters in JWT tokens
        encoded_token = quote(token, safe="")
        verify_link = f"{settings.DOMAIN}/verify-email?token={encoded_token}"

        # Queue Celery task to send email
        send_verify_email.apply_async(
            args=[user.email, user.full_name, verify_link],
            queue="email",
        )

        self.logger.info(
            "Queued verification email task for user_id=%s",
            user.id,
        )

    async def verify(self, token: str, request: Optional[Request] = None) -> User:
        """
        Override verify method to handle URL-decoded tokens.

        Args:
            token: Verification token (may be URL-encoded)
            request: Optional FastAPI request object

        Returns:
            User instance on successful verification

        Raises:
            InvalidVerifyToken: If the verification token is invalid, expired, or malformed
            UserAlreadyVerified: If the user is already verified
            Exception: Re-raises any exceptions from the parent verify method
        """
        import re

        from fastapi_users import exceptions

        # URL-decode if needed (fastapi-users expects decoded token)
        has_percent_encoding = (
            bool(re.search(r"%[0-9A-Fa-f]{2}", token)) if token else False
        )
        decoded_token = unquote(token) if has_percent_encoding and token else token

        # Call parent verify method with decoded token
        # BaseUserManager.verify raises InvalidVerifyToken or UserAlreadyVerified on failure
        # and returns User on success, so we propagate exceptions and return the User
        user = await super().verify(decoded_token, request)
        if user is None:
            # This should not happen if BaseUserManager.verify is implemented correctly,
            # but we ensure we raise an exception rather than returning None
            raise exceptions.InvalidVerifyToken()
        return user

    async def validate_password(self, password: str, user: User) -> None:
        """
        Validate password strength.

        Args:
            password: Password to validate
            user: User instance

        Raises:
            InvalidPasswordException: If password doesn't meet requirements
        """
        from fastapi_users import exceptions

        if len(password) < 8:
            raise exceptions.InvalidPasswordException(
                reason="Password should be at least 8 characters"
            )


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase[User, UUID] = Depends(get_user_db),
) -> UserManager:
    """
    Dependency function to get UserManager instance.

    Args:
        user_db: User database adapter

    Yields:
        UserManager instance
    """
    yield UserManager(user_db)


# Create FastAPIUsers instance
fastapi_users = FastAPIUsers[User, UUID](
    get_user_manager,
    [],  # List of authentication backends
)
