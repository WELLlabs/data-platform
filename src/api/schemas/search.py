"""
Search API schemas for request parameters and response models.
"""

from typing import List, Optional

from pydantic import BaseModel, Field


class SearchResultItem(BaseModel):
    """Single search result for JSON response (one dataset)."""

    dataset_id: str = Field(..., description="Dataset UUID string")
    file_id: str = Field("", description="File UUID string, or empty string when dataset-level")
    title: str = Field("", description="Title (dataset or file)")
    context: str = Field("", description="Searchable context text")
    score: float = Field(..., description="Weighted rank (fts_score * 0.7 + trigram_score * 0.3)")
    creator: str = Field("", description="Creator user UUID")
    creator_name: str = Field("", description="Contributor display name")
    created_at: Optional[str] = Field(None, description="Dataset created_at ISO timestamp")
    organization: str = Field("", description="Organization UUID")
    organization_name: str = Field("", description="Organization display name")
    availability: Optional[int] = Field(None, description="Dataset availability 0–4")
    downloads: Optional[int] = Field(None, description="Total file downloads")
    file_count: Optional[int] = Field(None, description="Number of files in the dataset")
    tags: List[str] = Field(default_factory=list, description="Dataset tag names")


class TagFacet(BaseModel):
    value: str = Field("", description="Tag name")
    count: int = Field(0, description="Number of matching documents")


class SearchResponse(BaseModel):
    """Response for GET /search: result array and total for pagination."""

    result: List[SearchResultItem] = Field(
        default_factory=list,
        description="Search results in descending order of score (paginated by limit/offset)",
    )
    total: int = Field(..., description="Total number of results (before pagination)")
    tag_facets: List[TagFacet] = Field(
        default_factory=list,
        description="Tag facet counts from Typesense when available",
    )
    topic_facets: List[TagFacet] = Field(
        default_factory=list,
        description="Topic facet counts from Typesense when available",
    )
