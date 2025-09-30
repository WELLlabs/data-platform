from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi_users import schemas
from pydantic import Field, validator


class UserRead(schemas.BaseUser[UUID]):
    full_name: str
    student: bool
    designation: Optional[str] = None
    team: Optional[str] = None
    organization: str
    role: int
    bio: Optional[str] = None
    phone: Optional[int] = None
    created_at: datetime
    verified: bool
    apikey: str
    contributions: int


class UserCreate(schemas.BaseUserCreate):
    full_name: str = Field(
        ..., min_length=1, max_length=50, description="User's full name"
    )
    student: bool = Field(default=False, description="Whether user is a student")
    designation: Optional[str] = Field(
        None, max_length=25, description="User's designation"
    )
    team: Optional[str] = Field(None, max_length=25, description="User's team")
    organization: str = Field(
        ..., min_length=1, max_length=50, description="User's organization"
    )
    role: int = Field(default=0, ge=0, description="User's role level")
    bio: Optional[str] = Field(None, max_length=1000, description="User's bio")
    phone: Optional[int] = Field(None, description="User's phone number")

    @validator("full_name", "organization")
    def validate_required_strings(cls, v):
        if not v or not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip()

    @validator("designation", "team", "bio")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("phone")
    def validate_phone(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Phone number must be positive")
        return v


class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating user data"""

    full_name: Optional[str] = Field(None, min_length=1, max_length=50)
    student: Optional[bool] = None
    designation: Optional[str] = Field(None, max_length=25)
    team: Optional[str] = Field(None, max_length=25)
    organization: Optional[str] = Field(None, min_length=1, max_length=50)
    role: Optional[int] = Field(None, ge=0)
    bio: Optional[str] = Field(None, max_length=1000)
    phone: Optional[int] = None
    verified: Optional[bool] = None

    @validator("full_name", "organization")
    def validate_required_strings(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip() if v else v

    @validator("designation", "team", "bio")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else v

    @validator("phone")
    def validate_phone(cls, v):
        if v is not None and v <= 0:
            raise ValueError("Phone number must be positive")
        return v
