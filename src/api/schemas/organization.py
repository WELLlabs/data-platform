from datetime import datetime
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


class OrganizationBase(BaseModel):
    """Base schema for organization data"""

    name: str = Field(
        ..., min_length=1, max_length=100, description="Organization name"
    )
    description: Optional[str] = Field(
        None, max_length=250, description="Organization description"
    )
    org_type: Optional[str] = Field(
        None, max_length=50, description="Type of organization"
    )
    contact: Optional[str] = Field(
        None, max_length=100, description="Contact information"
    )
    website: Optional[str] = Field(
        None, max_length=200, description="Organization website"
    )
    private: bool = Field(default=False, description="Whether organization is private")
    focus: Optional[List[str]] = Field(None, description="Focus areas (multi-select)")
    roi_states: Optional[List[str]] = Field(
        None, description="ROI states (multi-select)"
    )

    @validator("name")
    def validate_name(cls, v):
        if not v or not v.strip():
            raise ValueError("Organization name cannot be empty or just whitespace")
        return v.strip()

    @validator("description", "org_type", "contact", "website")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("focus", "roi_states")
    def validate_arrays(cls, v):
        if v is not None:
            # Remove empty strings and duplicates
            cleaned = list(set([item.strip() for item in v if item.strip()]))
            return cleaned if cleaned else None
        return v


class OrganizationCreate(OrganizationBase):
    """Schema for creating a new organization"""

    pass


class OrganizationRead(OrganizationBase):
    """Schema for reading organization data"""

    id: str = Field(..., description="Organization ID (generated from name)")
    creator: Optional[UUID] = Field(None, description="Creator user ID")
    contributions: int = Field(default=0, description="Number of contributions")
    created_at: datetime = Field(..., description="Creation timestamp")

    class Config:
        from_attributes = True


class OrganizationUpdate(BaseModel):
    """Schema for updating organization data"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=250)
    org_type: Optional[str] = Field(None, max_length=50)
    contact: Optional[str] = Field(None, max_length=100)
    website: Optional[str] = Field(None, max_length=200)
    private: Optional[bool] = None
    focus: Optional[List[str]] = None
    roi_states: Optional[List[str]] = None

    @validator("name")
    def validate_name(cls, v):
        if v is not None and not v.strip():
            raise ValueError("Organization name cannot be empty or just whitespace")
        return v.strip() if v else v

    @validator("description", "org_type", "contact", "website")
    def validate_optional_strings(cls, v):
        if v is not None and not v.strip():
            return None
        return v.strip() if v else v

    @validator("focus", "roi_states")
    def validate_arrays(cls, v):
        if v is not None:
            # Remove empty strings and duplicates
            cleaned = list(set([item.strip() for item in v if item.strip()]))
            return cleaned if cleaned else None
        return v


class OrganizationSearch(BaseModel):
    """Schema for organization search parameters"""

    query: Optional[str] = Field(None, description="Search query")
    org_type: Optional[str] = Field(None, description="Filter by organization type")
    private: Optional[bool] = Field(None, description="Filter by privacy setting")
    limit: int = Field(
        default=20, ge=1, le=100, description="Maximum number of results"
    )
    offset: int = Field(default=0, ge=0, description="Number of results to skip")
