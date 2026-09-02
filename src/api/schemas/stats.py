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
    contributions: int = Field(ge=0)


class HomepageStatsResponse(BaseModel):
    total_open_datasets: int = Field(ge=0)
    top_contributors: list[TopContributorItem]
    top_organizations: list[TopOrganizationItem]
