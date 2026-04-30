"""Data models for EdgeReco product catalog."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class Product(BaseModel):
    """A product in the catalog."""

    id: str
    title: str
    description: str = ""
    category: str
    subcategories: list[str] = []
    tags: list[str] = []
    brand: str = ""
    price: float | None = None
    currency: str = "USD"
    popularity_score: float = 0.0
    freshness_score: float = 0.0
    image_url: str = ""
    url: str = ""
    attributes: dict[str, str] = {}


class CatalogFile(BaseModel):
    """A file entry in a catalog manifest."""

    path: str
    file_type: str
    checksum: str
    rows: int | None = None


class DeltaFile(BaseModel):
    """A delta update file in a catalog manifest."""

    path: str
    from_version: str
    to_version: str
    checksum: str


class CatalogManifest(BaseModel):
    """Manifest describing a catalog version and its files."""

    catalog_id: str
    version: str
    embedding_model: str
    embedding_dim: int = 384
    files: list[CatalogFile]
    deltas: list[DeltaFile] = []


class SessionProfile(BaseModel):
    """User session profile for personalization."""

    category_affinity: dict[str, float] = {}
    tag_affinity: dict[str, float] = {}
    brand_affinity: dict[str, float] = {}
    recently_viewed: list[str] = []
    click_count: int = 0


class SearchResult(BaseModel):
    """A single search/recommendation result."""

    product: Product
    score: float
    score_components: dict[str, float] = {}


type EventType = Literal["click", "view", "favorite", "cart"]


class InteractionEvent(BaseModel):
    """A user interaction event."""

    event_type: EventType
    product_id: str
    timestamp: str
    metadata: dict[str, str] = {}
