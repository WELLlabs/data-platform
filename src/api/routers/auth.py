from fastapi import APIRouter, Depends, Form, HTTPException, status
from fastapi.responses import JSONResponse

from src.api.services.auth import AuthService, get_auth_service


router = APIRouter()


@router.post("/signin")
async def signin(
    email: str = Form(...),
    password: str = Form(...),
    auth: AuthService = Depends(get_auth_service),
):
    user, cookie = await auth.sign_in(email=email, password=password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    response = JSONResponse({"detail": "signed_in"})
    if cookie is not None:
        response.set_cookie(**cookie)
    return response


@router.post("/signup")
async def signup(
    name: str = Form(...),
    email: str = Form(...),
    password: str = Form(...),
    auth: AuthService = Depends(get_auth_service),
):
    await auth.sign_up(name=name, email=email, password=password)
    return {"detail": "signed_up"}


@router.post("/forgotpassword")
async def forgot_password(
    email: str = Form(...),
    auth: AuthService = Depends(get_auth_service),
):
    await auth.forgot_password(email=email)
    return {"detail": "reset_requested"}


