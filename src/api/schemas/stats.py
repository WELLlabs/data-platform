"""Pydantic schemas for homepage aggregate statistics."""

from uuid import UUID

from pydantic import BaseModel, Field


class TopContributorItem(BaseModel):
    user_id: UUID
    full_name: str
    contributions: int = Field(ge=0)


class TopOrganizationItem(BaseModel):
    organization_id: UUID
    organization_name: str
    contributions: int = Field(ge=0, description="Total datasets under this organization")
    open_contributions: int = Field(
        default=0,
        ge=0,
        description="Open datasets (public and approved) under this organization",
    )


class HomepageStatsResponse(BaseModel):
    total_open_datasets: int = Field(
        ge=0, description="Total dataset count (all datasets)"
    )
    total_public_datasets: int = Field(
        ge=0, description="Open dataset count (public and approved), across all organizations"
    )
    total_organizations: int = Field(
        ge=0, description="Number of organizations with at least one dataset"
    )
    total_contributors: int = Field(
        ge=0, description="Number of users who have created at least one dataset"
    )
    total_file_size: int = Field(
        ge=0, description="Sum of all file sizes in bytes"
    )
    top_contributors: list[TopContributorItem]
    top_organizations: list[TopOrganizationItem]
