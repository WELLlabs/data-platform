import logging
from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer
from schemas.user import UserCreate, UserRead
from services.auth import AuthService, get_auth_service
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


@router.post("/forgotpassword")
async def forgot_password(
    email: str = Form(...),
    controller: AuthController = Depends(get_auth_controller),
):
    """
    Password reset request endpoint.
    """
    return await controller.forgot_password(email)
