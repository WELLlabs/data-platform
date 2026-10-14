"""
File schemas for validation and serialization.
"""

from datetime import date
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator

from utils.temporal import parse_coverage_date

class MultipartPartComplete(BaseModel):
    part_number: int = Field(..., ge=1)
    etag: str = Field(..., min_length=1)


class CompleteMultipartRequest(BaseModel):
    job_id: str
    file_id: UUID
    upload_id: str
    parts: List[MultipartPartComplete]


class FileEditRequest(BaseModel):
    """
    Schema for editing file metadata via PUT request body.

    Keeps fields out of URL query parameters and avoids URL length limits.
    """

    file_id: UUID = Field(..., description="File ID (UUID) to update")
    file_title: str = Field(..., min_length=1, description="File title")
    file_description: Optional[str] = Field(
        None, description="File description"
    )
    provenance: Optional[str] = Field(
        None, max_length=125, description="Provenance"
    )
    source: Optional[str] = Field(
        None, max_length=1000, description="Source"
    )
    cite_as: Optional[str] = Field(
        None, description="Citation information"
    )
    groundtruthed: Optional[bool] = Field(
        None, description="Whether groundtruthed"
    )
    permissions: Optional[str] = Field(
        None, description="Permissions (CC license type)"
    )
    duration: int = Field(default=0, ge=0, description="Duration in years")
    temporal_from: Optional[date] = Field(
        None, description="Temporal coverage start (YYYY-MM-DD)"
    )
    temporal_to: Optional[date] = Field(
        None, description="Temporal coverage end (YYYY-MM-DD)"
    )
    geography: Optional[str] = Field(
        None, description="Geographic coverage"
    )

    @validator("file_title")
    def validate_file_title(cls, v):
        """Validate file title is non-empty."""
        if not v or not v.strip():
            raise ValueError("file_title cannot be empty or just whitespace")
        return v.strip()

    @validator("temporal_from", "temporal_to", pre=True)
    def validate_temporal_date(cls, v):
        """Accept a date or a legacy ISO datetime and keep the UTC calendar day."""
        if v is None or v == "":
            return None
        try:
            return parse_coverage_date(v)
        except ValueError as exc:
            raise ValueError("Temporal coverage must be a date (YYYY-MM-DD)") from exc

    @validator("temporal_to")
    def validate_temporal_range(cls, v, values):
        """Ensure temporal_to is not before temporal_from when both are set."""
        if v is None:
            return v
        from_val = values.get("temporal_from")
        if from_val is not None and v < from_val:
            raise ValueError("temporal_to must not be before temporal_from")
        return v
