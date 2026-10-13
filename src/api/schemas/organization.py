import re
from datetime import datetime
from typing import Dict, List, Optional
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
    allowed_email_domains: Optional[List[str]] = Field(
        None,
        description="Email domains that may join. Empty means any globally allowed domain.",
    )
    allow_password: bool = Field(
        default=True, description="Allow password sign-up for this organisation"
    )
    allow_google: bool = Field(
        default=True, description="Allow Google sign-in for this organisation"
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

    @validator("allowed_email_domains", pre=True)
    def validate_email_domains(cls, v):
        if v is None or v == "":
            return None
        parts = re.split(r"[,;\s]+", v) if isinstance(v, str) else v
        cleaned: List[str] = []
        for item in parts or []:
            domain = str(item).strip().lstrip("@").lower()
            if domain and domain not in cleaned:
                cleaned.append(domain)
        return cleaned or None

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

    id: UUID = Field(..., description="Organization UUID")
    creator: Optional[UUID] = Field(None, description="Creator user ID")
    created_at: datetime = Field(..., description="Creation timestamp")
    modified_at: Optional[datetime] = Field(None, description="Last modification timestamp")

    class Config:
        from_attributes = True


class OrganizationDetailRead(OrganizationRead):
    """Schema for reading organization data with detailed information"""

    creator_name: Optional[str] = Field(
        None, description="Full name of the organization creator"
    )
    contributions: int = Field(
        default=0,
        description="Sum of all members' contributions from user_contributions",
    )
    members: List[Dict] = Field(
        default_factory=list,
        description="List of organization members with user details",
    )
    privileges: Dict[str, bool] = Field(
        default_factory=dict, description="User privileges (edit, create)"
    )


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
    allowed_email_domains: Optional[List[str]] = None
    allow_password: Optional[bool] = None
    allow_google: Optional[bool] = None

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


class OrganizationListItem(BaseModel):
    """Schema for a single item in the organization list."""

    id: UUID = Field(..., description="Organization UUID")
    name: str = Field(..., description="Organization name")
    description: Optional[str] = None
    org_type: Optional[str] = None
    private: bool = False
    focus: Optional[List[str]] = None
    roi_states: Optional[List[str]] = None
    created_at: Optional[datetime] = None
    allowed_email_domains: Optional[List[str]] = None
    allow_password: bool = True
    allow_google: bool = True


class OrganizationListResponse(BaseModel):
    """Schema for the list organizations API response."""

    items: List[OrganizationListItem] = Field(
        default_factory=list,
        description="List of organizations with id and name",
    )


class OrganizationAddMember(BaseModel):
    email: str = Field(..., min_length=3, max_length=320)
    role: int = Field(default=0, ge=0, le=2)
    approve_now: bool = Field(
        default=False,
        description="If true, mark the member verified immediately",
    )


class OrganizationSearch(BaseModel):
    """Schema for organization search parameters"""

    query: Optional[str] = Field(None, description="Search query")
    org_type: Optional[str] = Field(None, description="Filter by organization type")
    private: Optional[bool] = Field(None, description="Filter by privacy setting")
    limit: int = Field(
        default=20, ge=1, le=100, description="Maximum number of results"
    )
    offset: int = Field(default=0, ge=0, description="Number of results to skip")
