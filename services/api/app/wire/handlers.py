"""Wire <-> domain adapter. The ONLY module that imports from both
app.generated (wire) and app.domain (business logic)."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import UTC, datetime

import structlog

from app.domain.types import DomainCandidateContext, DomainItem
from app.generated import models as wire

log = structlog.get_logger(__name__)

EventLogger = Callable[[wire.Event], None]


def build_healthz_response() -> dict[str, str]:
    return {"status": "ok"}


def _domain_to_wire_item(item: DomainItem) -> wire.CatalogItem:
    return wire.CatalogItem(
        id=item.id,
        title=item.title,
        category=item.category,
        tags=list(item.tags),
        popularityScore=item.popularity_score,
        freshnessScore=item.freshness_score,
    )


def build_catalog_response(
    catalog: Sequence[DomainItem],
) -> wire.CatalogResponse:
    return wire.CatalogResponse(
        items=[_domain_to_wire_item(i) for i in catalog],
        generatedAt=datetime.now(tz=UTC).isoformat(),
    )


def wire_to_domain_context(
    req: wire.CandidateRequest,
) -> DomainCandidateContext:
    return DomainCandidateContext(
        context_type=req.context_type,
        category_hint=req.category_hint,
        limit=req.limit,
    )


def build_candidate_response(
    items: Sequence[DomainItem],
) -> wire.CandidateResponse:
    return wire.CandidateResponse(
        items=[_domain_to_wire_item(i) for i in items],
    )


def _log_event(event: wire.Event) -> None:
    log.info(
        "edgereco.event",
        event_id=event.event_id,
        event_type=event.event_type,
        item_id=event.item_id,
        timestamp=event.timestamp,
        context_type=event.context_type,
    )


def ingest_event_batch(
    batch: wire.EventBatch,
    sink: EventLogger | None = None,
) -> int:
    emit = sink or _log_event
    for evt in batch.events:
        emit(evt)
    return len(batch.events)
