import logging
import re
from uuid import UUID

from core.config import settings
from fastapi import APIRouter, Body, Depends, Form, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from pydantic import EmailStr
from schemas.user import UserCreate, UserRead
from services.auth import (
    AuthService,
    RedisStrategy,
    fastapi_users,
    get_auth_service,
    get_user_db,
)
from utils.security import sanitize_input

# Security scheme for API key authentication
security = HTTPBearer()

router = APIRouter()

# Module-level logger
logger = logging.getLogger(__name__)


class AuthController:
    """
    Class-based authentication controller with security measures.
    """

    def __init__(self, auth_service: AuthService):
        self.auth_service = auth_service
        self.logger = logging.getLogger(__name__)

    async def sign_in(self, email: str, password: str) -> JSONResponse:
        """
        Handle user sign in with security validation.

        Args:
            email: User's email address
            password: User's password

        Returns:
            JSONResponse with user data and authentication cookie

        Raises:
            HTTPException: If authentication fails
        """
        # Sanitize inputs
        sanitized_email = sanitize_input(email)
        if not sanitized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format"
            )

        # Validate password is not empty
        if not password or not password.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Password is required"
            )

        try:
            user, cookie = await self.auth_service.sign_in(
                email=sanitized_email, password=password
            )

            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid credentials",
                )

            # Convert user to UserRead schema
            user_read = self.auth_service._user_to_user_read(user)

            # Create response with user data (ensure UUID/datetime are JSON-serializable)
            response = JSONResponse(
                content=jsonable_encoder(user_read.model_dump()),
                status_code=status.HTTP_200_OK,
            )

            # Set authentication cookie if provided
            if cookie is not None:
                response.set_cookie(**cookie)

            return response

        except HTTPException:
            raise
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication service error",
            )

    async def sign_up(self, user_data: UserCreate) -> JSONResponse:
        """
        Handle user registration with comprehensive validation.

        Args:
            user_data: User creation data

        Returns:
            JSONResponse with created user data

        Raises:
            HTTPException: If registration fails
        """
        try:
            # Log request details excluding sensitive fields
            self.logger.info(
                "Sign up request received: email=%s, full_name=%s, student=%s, org=%s, role=%s",
                user_data.email,
                user_data.full_name,
                user_data.student,
                user_data.organization,
                user_data.role,
            )
            # Create user using auth service
            user = await self.auth_service.sign_up(user_data)

            # Convert to UserRead schema
            user_read = self.auth_service._user_to_user_read(user)

            return JSONResponse(
                content=jsonable_encoder(user_read.model_dump()),
                status_code=status.HTTP_201_CREATED,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Unexpected error in sign_up controller: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="User registration service error",
            )

    async def get_current_user(self, request) -> JSONResponse:
        """
        Get current authenticated user information.

        Args:
            request: FastAPI request object to access cookies

        Returns:
            JSONResponse with current user data

        Raises:
            HTTPException: If user is not authenticated
        """
        try:
            # Get the session token from cookies
            session_token = request.cookies.get(settings.COOKIE_NAME)
            if not session_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="No authentication token found",
                )

            # Verify the session token with Redis
            strategy = RedisStrategy(
                self.auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS
            )
            user_id = await strategy.read_token(session_token)

            if not user_id:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired session",
                )

            # Get user from database
            user = await self.auth_service.user_db.get(UUID(user_id))
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
                )

            # Convert to UserRead schema
            user_read = self.auth_service._user_to_user_read(user)

            return JSONResponse(
                content=jsonable_encoder(user_read.model_dump()),
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception("Error getting current user: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Authentication service error",
            )

    async def sign_out(self, request) -> JSONResponse:
        """
        Handle user sign out and clear session.

        Args:
            request: FastAPI request object to access cookies

        Returns:
            JSONResponse with confirmation message
        """
        try:
            # Get the session token from cookies
            session_token = request.cookies.get(settings.COOKIE_NAME)
            if session_token:
                # Clear the session from Redis
                strategy = RedisStrategy(
                    self.auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS
                )
                await strategy.destroy_token(session_token)

            # Create response with cookie clearing
            response = JSONResponse(
                content={"detail": "Successfully signed out"},
                status_code=status.HTTP_200_OK,
            )

            # Clear the cookie
            response.set_cookie(
                key=settings.COOKIE_NAME,
                value="",
                max_age=0,
                httponly=True,
                samesite="lax",
            )

            return response

        except Exception as e:
            self.logger.exception("Error during sign out: %s", e)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Sign out service error",
            )

    # Removed forgot_password method - now using fastapi-users built-in /forgot-password route

    async def change_password(
        self, request: Request, current_password: str, new_password: str
    ) -> JSONResponse:
        """
        Handle password change request with validation.
        Gets authenticated user from session to prevent authorization bypass.

        Args:
            request: FastAPI request object to access cookies and session
            current_password: User's current password
            new_password: User's new password

        Returns:
            JSONResponse with success message

        Raises:
            HTTPException: If validation fails, user not authenticated, or password change fails
        """
        # Validate inputs
        if not current_password or not current_password.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current password is required",
            )

        if not new_password or not new_password.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="New password is required",
            )

        try:
            # Get the session token from cookies
            session_token = request.cookies.get(settings.COOKIE_NAME)
            if not session_token:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="No authentication token found",
                )

            # Verify the session token with Redis
            strategy = RedisStrategy(
                self.auth_service.redis, settings.COOKIE_MAX_AGE_SECONDS
            )
            user_id_str = await strategy.read_token(session_token)

            if not user_id_str:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid or expired session",
                )

            # Get user from database to verify they exist
            try:
                user_uuid = UUID(user_id_str)
            except ValueError:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid session token",
                )

            user = await self.auth_service.user_db.get(user_uuid)
            if not user:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
                )

            # Change password using authenticated user's ID
            await self.auth_service.change_password(
                user_id=user_uuid,
                current_password=current_password,
                new_password=new_password,
            )

            return JSONResponse(
                content={"detail": "Password changed successfully"},
                status_code=status.HTTP_200_OK,
            )

        except HTTPException:
            raise
        except Exception as e:
            self.logger.exception(
                "Unexpected error in change_password controller: %s", e
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Password change service error",
            )


# Dependency to get auth controller
async def get_auth_controller(
    auth_service: AuthService = Depends(get_auth_service),
) -> AuthController:
    return AuthController(auth_service)


# Route handlers
@router.post("/signin", response_model=UserRead)
async def signin(
    email: str = Form(...),
    password: str = Form(...),
    controller: AuthController = Depends(get_auth_controller),
):
    """
    User sign in endpoint with security validation.
    """
    return await controller.sign_in(email, password)


@router.post("/signup", response_model=UserRead)
async def signup(
    user_data: UserCreate,
    controller: AuthController = Depends(get_auth_controller),
):
    """
    User registration endpoint with comprehensive validation.
    """
    return await controller.sign_up(user_data)


@router.get("/me", response_model=UserRead)
async def get_current_user(
    request: Request,
    controller: AuthController = Depends(get_auth_controller),
):
    """
    Get current authenticated user information.
    """
    return await controller.get_current_user(request)


@router.post("/signout")
async def signout(
    request: Request,
    controller: AuthController = Depends(get_auth_controller),
):
    """
    User sign out endpoint.
    """
    return await controller.sign_out(request)


# Include fastapi-users reset password router
# This provides POST /forgot-password and POST /reset-password endpoints
router.include_router(
    fastapi_users.get_reset_password_router(),
    prefix="",
    tags=["Authentication"],
)

# Include fastapi-users verify router
# This provides POST /request-verify-token and POST /verify endpoints
router.include_router(
    fastapi_users.get_verify_router(user_schema=UserRead),
    prefix="",
    tags=["Authentication"],
)


@router.post("/reset-password/validate")
async def reset_password_validate(
    token: str = Body(..., embed=True),
    user_db=Depends(get_user_db),
) -> JSONResponse:
    """
    Validate reset password token using fastapi-users' validation method.

    Args:
        token: Reset password token to validate (may be URL-encoded)
        user_db: User database dependency

    Returns:
        JSONResponse with validation result
    """
    try:
        from datetime import datetime, timezone
        from urllib.parse import unquote

        import jwt
        from fastapi_users import exceptions
        from services.auth import UserManager

        logger.info(
            "Validating reset password token (token length: %d)",
            len(token),
        )

        # URL-decode the token only if it contains percent-encoding
        # This prevents double-decoding tokens that are already decoded
        has_percent_encoding = bool(re.search(r'%[0-9A-Fa-f]{2}', token))
        if has_percent_encoding:
            decoded_token = unquote(token)
            logger.debug(
                "Token contains percent-encoding, URL-decoded (token length: %d)",
                len(decoded_token),
            )
        else:
            decoded_token = token
            logger.debug(
                "Token does not contain percent-encoding, kept as-is (token length: %d)",
                len(decoded_token),
            )

        user_manager = UserManager(user_db)
        is_secret_configured = bool(
            user_manager.reset_password_token_secret
            and len(user_manager.reset_password_token_secret) > 0
        )
        logger.debug(
            "Reset password token secret configured: %s",
            "configured" if is_secret_configured else "not configured",
        )

        # Use fastapi-users' built-in token verification method
        # This matches the validation used by the actual reset endpoint
        try:
            user = None
            # Try to use fastapi-users' verify_password_reset_token method if available
            # If not available, fall back to using the reset_password method's internal validation
            if hasattr(user_manager, "verify_password_reset_token"):
                user_id = await user_manager.verify_password_reset_token(decoded_token)
                # Fetch user after verification
                user = await user_db.get(user_id)
            else:
                # Fallback: Use the same method that reset_password router uses internally
                # This decodes the token and validates it using fastapi-users' internal logic

                # Decode token using fastapi-users' secret and algorithm
                # IMPORTANT: We need to verify the audience claim
                payload = jwt.decode(
                    decoded_token,
                    user_manager.reset_password_token_secret,
                    algorithms=["HS256"],
                    audience="fastapi-users:reset",  # Verify audience claim
                )

                # Extract user_id from token
                if "sub" not in payload:
                    logger.warning("Token missing 'sub' claim")
                    raise exceptions.InvalidResetPasswordToken()

                user_id = UUID(payload["sub"])

                # Verify user exists first
                user = await user_db.get(user_id)
                if not user:
                    logger.warning(
                        "Token valid but user not found for user_id=%s", user_id
                    )
                    raise exceptions.InvalidResetPasswordToken()

                # Note: We don't check password_fgpt during validation
                # fastapi-users only checks password fingerprint when actually resetting the password,
                # not during token validation. This allows users to request multiple reset tokens
                # and use any valid one, even if they requested a new one after changing their password.
                # The actual reset password endpoint will verify the fingerprint when the password is changed.

                # Check expiration (JWT decode already validates exp, but we double-check)
                if "exp" in payload:
                    exp_timestamp = payload.get("exp")
                    if exp_timestamp:
                        exp_datetime = datetime.fromtimestamp(
                            exp_timestamp, tz=timezone.utc
                        )
                        if exp_datetime <= datetime.now(timezone.utc):
                            logger.warning("Token expired for user_id=%s", user_id)
                            raise exceptions.InvalidResetPasswordToken()

            logger.info("Token verified successfully for user_id=%s", user_id)

            if user:
                logger.info(
                    "Reset password token validation successful for user_id=%s", user_id
                )
                return JSONResponse(
                    content={"valid": True}, status_code=status.HTTP_200_OK
                )
            else:
                logger.warning(
                    "Token valid but user not found for user_id=%s", user_id
                )
                return JSONResponse(
                    content={"valid": False}, status_code=status.HTTP_200_OK
                )
        except jwt.InvalidTokenError as token_error:
            # Token is invalid, expired, or malformed
            logger.warning(
                "Token validation failed (InvalidTokenError): %s",
                str(token_error),
            )
        except exceptions.InvalidResetPasswordToken as token_error:
            # Token is invalid according to fastapi-users
            logger.warning(
                "Token validation failed (InvalidResetPasswordToken): %s",
                str(token_error),
            )
        except Exception as token_error:
            # Other errors
            logger.warning(
                "Token validation failed: %s (type: %s)",
                str(token_error),
                type(token_error).__name__,
                exc_info=True,
            )

        logger.info("Reset password token validation failed")
        return JSONResponse(content={"valid": False}, status_code=status.HTTP_200_OK)
    except Exception as e:
        logger.exception("Error validating reset password token: %s", e)
        return JSONResponse(content={"valid": False}, status_code=status.HTTP_200_OK)


@router.post("/send-verify-email")
async def send_verify_email(
    email: EmailStr = Body(..., embed=True),
    user_db=Depends(get_user_db),
) -> JSONResponse:
    """
    Send verification email to user.

    Args:
        email: User's email address
        user_db: User database dependency

    Returns:
        JSONResponse with success message
    """
    try:
        from urllib.parse import quote

        from fastapi_users.jwt import generate_jwt
        from services.auth import UserManager
        from tasks.email import send_verify_email as send_verify_email_task

        user_manager = UserManager(user_db)
        user = await user_db.get_by_email(email)

        if not user:
            # For security, always return success even if user doesn't exist
            return JSONResponse(
                content={
                    "detail": "If this email exists, a verification email has been sent."
                },
                status_code=status.HTTP_200_OK,
            )

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
            "aud": user_manager.verification_token_audience,
        }

        token = generate_jwt(
            token_data,
            user_manager.verification_token_secret,
            user_manager.verification_token_lifetime_seconds,
        )

        # URL-encode the token to handle special characters in JWT tokens
        encoded_token = quote(token, safe="")
        verify_link = f"{settings.DOMAIN}/verify-email?token={encoded_token}"

        # Queue Celery task to send email
        send_verify_email_task.apply_async(
            args=[user.email, user.full_name, verify_link],
            queue="email",
        )

        logger.info("Queued verification email for user_id=%s", user.id)

        return JSONResponse(
            content={"detail": "Verification email has been sent."},
            status_code=status.HTTP_200_OK,
        )
    except Exception as e:
        logger.exception("Error sending verification email: %s", e)
        # For security, always return success
        return JSONResponse(
            content={
                "detail": "If this email exists, a verification email has been sent."
            },
            status_code=status.HTTP_200_OK,
        )


@router.post("/changepassword")
async def change_password(
    request: Request,
    current_password: str = Form(...),
    new_password: str = Form(...),
    controller: AuthController = Depends(get_auth_controller),
):
    """
    Change authenticated user's password endpoint with current password verification.
    User ID is derived from session token to prevent authorization bypass.
    """
    return await controller.change_password(request, current_password, new_password)
