from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi_users import schemas
from pydantic import Field, validator


class UserRead(schemas.BaseUser[UUID]):
    full_name: str
    student: bool
    designation: Optional[str] = None
    organization: str
    role: int
    phone: Optional[str] = None
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
    organization: str = Field(
        ..., min_length=1, max_length=50, description="User's organization"
    )
    role: int = Field(default=0, ge=0, description="User's role level")
    phone: Optional[str] = Field(None, max_length=20, description="User's phone number")

    @validator("full_name", "organization")
    def validate_required_strings(cls, v):
        if not v or not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip()

    @validator("designation")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("phone")
    def validate_phone(cls, v):
        if v is not None:
            # Convert to string if it's not already
            v_str = str(v).strip() if not isinstance(v, str) else v.strip()
            # If empty after stripping, return None
            if not v_str:
                return None
            # Validate it contains only digits
            if not v_str.isdigit():
                raise ValueError("Phone number must contain only digits")
            # Validate length (max 20 characters as per model)
            if len(v_str) > 20:
                raise ValueError("Phone number must be 20 characters or less")
            return v_str
        return None


class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating user data"""

    full_name: Optional[str] = Field(None, min_length=1, max_length=50)
    student: Optional[bool] = None
    designation: Optional[str] = Field(None, max_length=25)
    organization: Optional[str] = Field(None, min_length=1, max_length=50)
    role: Optional[int] = Field(None, ge=0)
    phone: Optional[str] = None
    verified: Optional[bool] = None

    @validator("full_name", "organization")
    def validate_required_strings(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip() if v else v

    @validator("designation")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else v

    @validator("phone")
    def validate_phone(cls, v):
        if v is not None:
            # Convert to string if it's not already
            v_str = str(v).strip() if not isinstance(v, str) else v.strip()
            # If empty after stripping, return None
            if not v_str:
                return None
            # Validate it contains only digits
            if not v_str.isdigit():
                raise ValueError("Phone number must contain only digits")
            # Validate length (max 20 characters as per model)
            if len(v_str) > 20:
                raise ValueError("Phone number must be 20 characters or less")
            return v_str
        return None
