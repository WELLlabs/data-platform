from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.responses import JSONResponse

from schemas.user import UserCreate, UserRead
from services.auth import AuthService, get_auth_service

router = APIRouter()


@router.post("/signin", response_model=UserRead)
async def signin(
    email: str = Form(...),
    password: str = Form(...),
    auth: AuthService = Depends(get_auth_service),
):
    user, cookie = await auth.sign_in(email=email, password=password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials"
        )
    user_read = UserRead(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=user.is_verified,
        full_name=user.full_name,
    )
    response = JSONResponse(user_read.model_dump())
    if cookie is not None:
        response.set_cookie(**cookie)
    return response


@router.post("/signup", response_model=UserRead)
async def signup(
    user_in: UserCreate,
    auth: AuthService = Depends(get_auth_service),
):
    user = await auth.sign_up(
        name=(user_in.full_name or ""),
        email=user_in.email,
        password=user_in.password,
    )
    return UserRead(
        id=user.id,
        email=user.email,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        is_verified=user.is_verified,
        full_name=user.full_name,
    )


@router.post("/forgotpassword")
async def forgot_password(
    email: str = Form(...),
    auth: AuthService = Depends(get_auth_service),
):
    await auth.forgot_password(email=email)
    return {"detail": "reset_requested"}
