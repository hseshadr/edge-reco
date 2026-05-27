"""Thin FastAPI wrapper adding CORS + a browse endpoint over edge-reco's engine.

The demo storefront is a browser SPA (Vite dev server on :5173, preview on
:4173) that calls edge-reco's API directly. The library's ``create_app`` adds
no CORS and exposes only ``/search`` + ``/recommend``; a storefront also needs a
plain catalog-browse feed. So this module loads the committed demo catalog, builds
the engine's ``ServiceContainer``, wraps the app with ``CORSMiddleware``, and mounts
a typed ``/products`` browse route over the same catalog.

Launch:
    uv run uvicorn demo.backend.main:app --port 8000
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product

CATALOG_PATH = Path(__file__).parent / "catalog" / "products.jsonl"

ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:4173",
)


class BrowseResponse(BaseModel):
    """Catalog browse page: a window of products plus the category facets."""

    products: list[Product]
    total: int
    categories: list[str]


def load_catalog() -> list[Product]:
    """Load the committed demo catalog as a list of edge-reco Products."""
    return load_jsonl(CATALOG_PATH)


def _browse_router(products: list[Product]) -> APIRouter:
    """A read-only catalog-browse feed over the in-memory demo catalog."""
    router = APIRouter()
    categories = sorted({product.category for product in products})

    @router.get("/products")
    def list_products(
        category: Annotated[str | None, Query()] = None,
        limit: Annotated[int, Query(ge=1, le=100)] = 24,
        offset: Annotated[int, Query(ge=0)] = 0,
    ) -> BrowseResponse:
        items = [p for p in products if category is None or p.category == category]
        return BrowseResponse(
            products=items[offset : offset + limit], total=len(items), categories=categories
        )

    return router


def build_app() -> FastAPI:
    """Build the edge-reco app over the demo catalog with CORS + browse enabled."""
    catalog = load_catalog()
    fastapi_app = create_app(ServiceContainer.from_catalog(catalog))
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    fastapi_app.include_router(_browse_router(catalog))
    return fastapi_app


app = build_app()
