"""
Dataset schemas for validation and serialization.
"""

from datetime import date
from typing import List, Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator

from core.availability import parse_availability
from utils.temporal import parse_coverage_date


class DatasetCreate(BaseModel):
    """
    Schema for creating a dataset via form data.
    
    This schema validates all input fields from the frontend form
    and ensures data integrity before database insertion.
    """

    # Dataset fields
    title: str = Field(..., min_length=1, description="Dataset title")
    creator: UUID = Field(..., description="Creator user ID (UUID)")
    dataset_description: Optional[str] = Field(
        None, description="Dataset description"
    )
    tags: Optional[List[str]] = Field(
        None, description="Tags for the dataset (list of strings)"
    )
    organization: UUID = Field(..., description="Organization UUID")
    availability: int = Field(
        default=0,
        ge=0,
        le=4,
        description="0 public, 1 private, 2 organization, 3 admins, 4 owners",
    )

    # File fields
    filename: str = Field(..., min_length=1, description="File name")
    file_key: str = Field(..., min_length=1, description="S3 file key")
    file_description: Optional[str] = Field(
        None, description="File description"
    )
    file_format: Optional[str] = Field(
        None, max_length=20, description="File format/extension"
    )
    # Moved fields from dataset to file
    provenance: Optional[str] = Field(
        None, max_length=125, description="Provenance"
    )
    source: Optional[str] = Field(
        None, max_length=1000, description="Source"
    )
    cite_as: Optional[str] = Field(
        None, max_length=1500, description="Citation information"
    )
    groundtruthed: Optional[bool] = Field(
        None, description="Whether dataset is groundtruthed"
    )
    permissions: Optional[str] = Field(
        None, description="Permissions (CC license type)"
    )
    duration: int = Field(default=0, ge=0, description="Duration in years")
    # New file fields
    temporal_from: Optional[date] = Field(
        None, description="Temporal coverage start date"
    )
    temporal_to: Optional[date] = Field(
        None, description="Temporal coverage end date"
    )
    geography: Optional[str] = Field(
        None, description="Geographic coverage"
    )

    @validator("availability", pre=True)
    def coerce_availability(cls, v):
        return parse_availability(v)

    @validator("title")
    def validate_title(cls, v):
        """Validate and sanitize title."""
        if not v or not v.strip():
            raise ValueError("Title cannot be empty or just whitespace")
        return v.strip()

    @validator("filename")
    def validate_filename(cls, v):
        """Validate and sanitize filename."""
        if not v or not v.strip():
            raise ValueError("Filename cannot be empty or just whitespace")
        return v.strip()

    @validator("file_key")
    def validate_file_key(cls, v):
        """Validate file_key."""
        if not v or not v.strip():
            raise ValueError("File key cannot be empty or just whitespace")
        return v.strip()

    @validator("dataset_description", "file_description")
    def validate_descriptions(cls, v):
        """Validate and sanitize descriptions."""
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("provenance", "source", "cite_as", "file_format", "geography")
    def validate_optional_strings(cls, v):
        """Validate and sanitize optional string fields."""
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("tags")
    def validate_tags(cls, v):
        """Validate tags list."""
        if v is None:
            return None
        if not isinstance(v, list):
            return None
        # Filter out empty strings and strip whitespace
        processed = [tag.strip() for tag in v if tag and tag.strip()]
        return processed if processed else None

    @validator("permissions")
    def validate_permissions(cls, v):
        """Validate permissions field - must be one of the allowed CC license values."""
        # Allowed CC license values
        allowed_permissions = [
            "CC0: Public Domain",
            "CC BY: Attribution",
            "CC BY-SA: Attribution-ShareAlike",
            "CC BY-NC: Attribution-NonCommercial",
            "CC BY-NC-SA: Attribution-NonCommercial-ShareAlike",
            "CC BY-ND: Attribution-NoDerivatives",
            "CC BY-NC-ND: Attribution-NonCommercial-NoDerivatives",
        ]
        
        # If None or empty, default to "CC0: Public Domain"
        if v is None or (isinstance(v, str) and not v.strip()):
            return "CC0: Public Domain"
        
        # Strip whitespace and validate
        v_stripped = v.strip() if isinstance(v, str) else str(v).strip()
        
        # If not in allowed list, default to "CC0: Public Domain"
        if v_stripped not in allowed_permissions:
            return "CC0: Public Domain"
        
        return v_stripped

    @validator("organization")
    def validate_organization(cls, v):
        if v is None:
            raise ValueError("Organization ID cannot be empty")
        return v

    @validator("temporal_from", "temporal_to", pre=True)
    def validate_temporal_date(cls, v):
        if v is None or v == "":
            return None
        try:
            return parse_coverage_date(v)
        except ValueError as exc:
            raise ValueError("Temporal coverage must be a date (YYYY-MM-DD)") from exc

    @validator("temporal_to")
    def validate_temporal_range(cls, v, values):
        """Validate that temporal_to is not before temporal_from if both are provided."""
        if v is not None and "temporal_from" in values and values["temporal_from"] is not None:
            if v < values["temporal_from"]:
                raise ValueError("temporal_to must not be before temporal_from")
        return v


class EditDatasetRequest(BaseModel):
    """
    Schema for editing dataset metadata via PUT request body.

    Keeps sensitive fields out of URL query parameters.
    """

    dataset_id: UUID = Field(..., description="Dataset ID (UUID) to update")
    dataset_title: str = Field(..., min_length=1, description="Dataset title")
    dataset_description: Optional[str] = Field(
        None, description="Dataset description"
    )
    availability: int = Field(
        ...,
        ge=0,
        le=4,
        description="0 public, 1 private, 2 organization, 3 admins, 4 owners",
    )
    tags: List[str] = Field(..., description="Tags (list of strings, required, at least one)")

    @validator("availability", pre=True)
    def coerce_availability(cls, v):
        return parse_availability(v)

    @validator("dataset_title")
    def validate_dataset_title(cls, v):
        """Validate dataset title is non-empty."""
        if not v or not v.strip():
            raise ValueError("dataset_title cannot be empty or just whitespace")
        return v.strip()

    @validator("dataset_description")
    def validate_dataset_description(cls, v):
        """Strip whitespace and convert empty or whitespace-only to None."""
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("tags", pre=True)
    def validate_tags_list(cls, v):
        """Require at least one tag; normalize to list of stripped non-empty strings."""
        if v is None:
            raise ValueError("Tags are required")
        if not isinstance(v, list):
            raise ValueError("Tags are required")
        normalized = [str(t).strip() for t in v if t is not None and str(t).strip()]
        if not normalized:
            raise ValueError("Tags are required")
        return normalized

