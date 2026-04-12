"""FastAPI app wiring for EdgeReco Phase 0 API."""

from __future__ import annotations

import os
from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.domain.catalog import filter_candidates, load_catalog
from app.domain.types import DomainItem
from app.generated import models as wire
from app.wire.handlers import (
    build_candidate_response,
    build_catalog_response,
    build_healthz_response,
    ingest_event_batch,
    wire_to_domain_context,
)


def _default_catalog_path() -> Path:
    env = os.environ.get("EDGERECO_CATALOG_PATH")
    if env:
        return Path(env)
    return Path(__file__).resolve().parents[3] / "data" / "catalog.json"


def _load_default_catalog() -> list[DomainItem]:
    path = _default_catalog_path()
    if not path.exists():
        structlog.get_logger(__name__).warning(
            "catalog.missing", path=str(path)
        )
        return []
    return load_catalog(path)


def create_app(catalog: list[DomainItem] | None = None) -> FastAPI:
    structlog.configure(
        processors=[
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
    )
    loaded = catalog if catalog is not None else _load_default_catalog()

    app = FastAPI(title="EdgeReco API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/v0/healthz")
    async def healthz() -> dict[str, str]:
        return build_healthz_response()

    @app.get("/v0/catalog", response_model=wire.CatalogResponse)
    async def get_catalog() -> wire.CatalogResponse:
        return build_catalog_response(loaded)

    @app.post("/v0/candidates", response_model=wire.CandidateResponse)
    async def post_candidates(req: wire.CandidateRequest) -> wire.CandidateResponse:
        ctx = wire_to_domain_context(req)
        items = filter_candidates(loaded, ctx)
        return build_candidate_response(items)

    @app.post("/v0/events", status_code=202)
    async def post_events(batch: wire.EventBatch) -> dict[str, int]:
        count = ingest_event_batch(batch)
        return {"received": count}

    return app


app = create_app()
