import logging
from uuid import UUID

from core.config import settings
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from schemas.user import UserCreate, UserRead
from services.auth import AuthService, RedisStrategy, get_auth_service
from utils.security import sanitize_input

# Security scheme for API key authentication
security = HTTPBearer()

router = APIRouter()


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

    async def forgot_password(self, email: str) -> JSONResponse:
        """
        Handle password reset request.

        Args:
            email: User's email address

        Returns:
            JSONResponse with confirmation message
        """
        # Sanitize email input
        sanitized_email = sanitize_input(email)
        if not sanitized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid email format"
            )

        try:
            await self.auth_service.forgot_password(email=sanitized_email)
            return JSONResponse(
                content={"detail": "Password reset request submitted"},
                status_code=status.HTTP_200_OK,
            )
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Password reset service error",
            )

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
                status_code=status.HTTP_400_BAD_REQUEST, detail="New password is required"
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
            self.logger.exception("Unexpected error in change_password controller: %s", e)
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


@router.post("/forgotpassword")
async def forgot_password(
    email: str = Form(...),
    controller: AuthController = Depends(get_auth_controller),
):
    """
    Password reset request endpoint.
    """
    return await controller.forgot_password(email)


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
