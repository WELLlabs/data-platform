"""
Dataset schemas for validation and serialization.
"""

from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, validator


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
    tags: Optional[str] = Field(
        None, max_length=500, description="Tags for the dataset"
    )
    organization: str = Field(
        ..., min_length=1, max_length=100, description="Organization ID"
    )
    author: Optional[str] = Field(
        None, max_length=125, description="Author name"
    )
    source_url: Optional[str] = Field(
        None, max_length=1000, description="Source URL"
    )
    cite_as: Optional[str] = Field(
        None, max_length=1500, description="Citation information"
    )
    groundtruthed: Optional[bool] = Field(
        None, description="Whether dataset is groundtruthed"
    )
    private: bool = Field(default=False, description="Whether dataset is private")

    # File fields
    filename: str = Field(..., min_length=1, description="File name")
    file_key: str = Field(..., min_length=1, description="S3 file key")
    file_description: Optional[str] = Field(
        None, description="File description"
    )
    file_format: Optional[str] = Field(
        None, max_length=20, description="File format/extension"
    )

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

    @validator("tags", "author", "source_url", "cite_as", "file_format")
    def validate_optional_strings(cls, v):
        """Validate and sanitize optional string fields."""
        if v is not None and not v.strip():
            return None
        return v.strip() if v else None

    @validator("organization")
    def validate_organization(cls, v):
        """Validate organization ID."""
        if not v or not v.strip():
            raise ValueError("Organization ID cannot be empty")
        return v.strip()

