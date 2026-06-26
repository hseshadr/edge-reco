"""Typed response models for the EdgeReco HTTP API.

These mirror the JSON each route returns so handlers can declare a precise
``response_model`` instead of an opaque ``dict[str, Any]``. Field names and
nesting match the wire format the frontend and tests rely on.
"""

from __future__ import annotations

from pydantic import BaseModel

from edgereco.catalog.models import SearchResult
from edgereco.reco.retrain import EngagementStat


class IndexStats(BaseModel):
    """Sizes of the keyword and vector indices backing a catalog."""

    keyword_corpus_size: int
    vector_index_size: int


class CatalogInfo(BaseModel):
    """Response for ``GET /catalog/info``."""

    catalog_id: str
    version: str
    product_count: int
    index_stats: IndexStats


class SearchResponse(BaseModel):
    """Response for ``GET /search``."""

    results: list[SearchResult]
    query: str
    total: int


class RecommendResponse(BaseModel):
    """Response for ``GET /recommend``."""

    results: list[SearchResult]
    session_clicks: int


class EventsResponse(BaseModel):
    """Response for ``POST /events``."""

    received: int


class EngagementExport(BaseModel):
    """Response for ``GET /events/export`` — the cloud retrain read seam.

    Aggregated weighted engagement per product over the collector's event buffer.
    The ``edgereco retrain`` job pulls this, blends it into ``popularity_score``,
    and republishes the signed bundle.
    """

    total_events: int
    stats: list[EngagementStat]
