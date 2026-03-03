"""
File schemas for validation and serialization.
"""

from datetime import datetime, timezone
from typing import Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator

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
    value: Optional[Literal["high", "medium", "low"]] = Field(
        None, description="Value level (high, medium, low)"
    )
    temporal_from: Optional[datetime] = Field(
        None, description="Temporal coverage start (ISO 8601)"
    )
    temporal_to: Optional[datetime] = Field(
        None, description="Temporal coverage end (ISO 8601)"
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
    def validate_temporal_iso8601(cls, v):
        """Parse and validate ISO 8601 datetime strings."""
        if v is None or isinstance(v, datetime):
            return v
        if not isinstance(v, str):
            raise ValueError("Temporal field must be a string or datetime")
        if not v.strip():
            return None
        s = v.strip().replace("Z", "+00:00")
        try:
            return datetime.fromisoformat(s)
        except (ValueError, TypeError) as e:
            raise ValueError(
                f"Invalid ISO 8601 datetime: {v!r}"
            ) from e

    @validator("temporal_to")
    def validate_temporal_range(cls, v, values):
        """Ensure temporal_to is after temporal_from when both are set."""
        if v is None:
            return v
        from_val = values.get("temporal_from")
        if from_val is None:
            return v

        def to_utc(dt):
            if dt.tzinfo is None:
                return dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)

        v_utc = to_utc(v)
        from_utc = to_utc(from_val)
        if v_utc < from_utc:
            raise ValueError("temporal_to must be after temporal_from")
        return v
