from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi_users import schemas
from pydantic import BaseModel, Field, validator


class UserRead(schemas.BaseUser[UUID]):
    full_name: str
    designation: Optional[str] = None
    organization: Optional[UUID] = None
    role: int
    created_at: datetime
    modified_at: Optional[datetime] = None
    verified: bool
    contributions: int
    auth_provider: str = "password"
    profile_complete: bool = True


class UserCreate(schemas.BaseUserCreate):
    full_name: str = Field(
        ..., min_length=1, max_length=50, description="User's full name"
    )
    designation: Optional[str] = Field(
        None, max_length=25, description="User's designation"
    )
    organization: UUID = Field(..., description="Organization UUID")
    role: int = Field(default=0, ge=0, description="User's role level")

    @validator("full_name")
    def validate_required_strings(cls, v):
        if not v or not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip()

    @validator("designation")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

class UserUpdate(schemas.BaseUserUpdate):
    """Schema for updating user data"""

    full_name: Optional[str] = Field(None, min_length=1, max_length=50)
    designation: Optional[str] = Field(None, max_length=25)
    organization: Optional[UUID] = None
    role: Optional[int] = Field(None, ge=0)
    verified: Optional[bool] = None

    @validator("full_name")
    def validate_required_strings(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip() if v else v

    @validator("designation")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else v

class CompleteProfileUpdate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=50)
    organization: UUID
    designation: Optional[str] = Field(None, max_length=25)

    @validator("full_name")
    def validate_required_strings(cls, v):
        if not v or not v.strip():
            raise ValueError("Field cannot be empty or just whitespace")
        return v.strip()

    @validator("designation")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None


class DatasetOwnerCreate(BaseModel):
    dataset_id: UUID
    user_id: UUID
