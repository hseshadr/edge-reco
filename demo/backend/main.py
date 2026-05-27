"""Thin FastAPI wrapper adding CORS over edge-reco's recommendation engine.

The demo storefront is a browser SPA (Vite dev server on :5173, preview on
:4173) that calls edge-reco's API directly. The library's ``create_app`` adds
no CORS, so this module loads the committed demo catalog, builds the engine's
``ServiceContainer``, and wraps the resulting app with ``CORSMiddleware``.

Launch:
    uv run uvicorn demo.backend.main:app --port 8000
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product

CATALOG_PATH = Path(__file__).parent / "catalog" / "products.jsonl"

ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:4173",
)


def load_catalog() -> list[Product]:
    """Load the committed demo catalog as a list of edge-reco Products."""
    return load_jsonl(CATALOG_PATH)


def build_app() -> FastAPI:
    """Build the edge-reco app over the demo catalog with CORS enabled."""
    container = ServiceContainer.from_catalog(load_catalog())
    fastapi_app = create_app(container)
    fastapi_app.add_middleware(
        CORSMiddleware,
        allow_origins=list(ALLOWED_ORIGINS),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return fastapi_app


app = build_app()
