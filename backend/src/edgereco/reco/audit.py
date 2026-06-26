"""Retrain audit: explain exactly what a retrain changed and why.

A pure, read-only reporting surface — NEVER in the inference path. Given the
collected session logs plus the catalog + co-occurrence before and after a fresh
retrain, it summarises the events that drove the change (counts by type / session),
the top popularity movers (sorted by absolute Δ), and how many co-occurrence edges
were added or changed. ``edgereco audit`` renders the typed report as a table so a
maintainer can trace every ranking change back to the events behind it.
"""

from __future__ import annotations

from collections import defaultdict

from pydantic import BaseModel

from edgereco.catalog.models import EventType, InteractionEvent, Product
from edgereco.reco.cooccurrence import (
    CooccurrenceMatrix,
    SessionLog,
    build_cooccurrence,
    sessions_from_logs,
)
from edgereco.reco.retrain import aggregate_engagement, blend_popularity

#: Default number of popularity movers to surface.
DEFAULT_TOP_MOVERS = 10


class AuditInputs(BaseModel):
    """The before/after catalog + co-occurrence a dry-run retrain would produce."""

    before: list[Product]
    after: list[Product]
    before_cooccurrence: CooccurrenceMatrix
    after_cooccurrence: CooccurrenceMatrix


def audit_inputs(
    *,
    products: list[Product],
    logs: list[SessionLog],
    alpha: float,
    current_cooccurrence: CooccurrenceMatrix | None = None,
) -> AuditInputs:
    """Preview a retrain (popularity + co-occurrence) from the session log alone.

    The log IS the collected events: engagement (popularity) is derived from it the
    same way retrain does, and co-occurrence from its baskets. Publishes nothing.
    """
    engagement = aggregate_engagement(_events_from_logs(logs))
    return AuditInputs(
        before=products,
        after=blend_popularity(products, engagement, alpha=alpha),
        before_cooccurrence=current_cooccurrence or CooccurrenceMatrix(),
        after_cooccurrence=build_cooccurrence(sessions_from_logs(logs)),
    )


def _events_from_logs(logs: list[SessionLog]) -> list[InteractionEvent]:
    """Flatten session logs into ``InteractionEvent``s for engagement aggregation."""
    return [
        InteractionEvent(event_type=event.event_type, product_id=event.product_id, timestamp="")
        for log in logs
        for event in log.events
    ]


class PopularityMover(BaseModel):
    """A product whose popularity changed in the retrain, with its delta."""

    product_id: str
    before: float
    after: float
    delta: float


class AuditReport(BaseModel):
    """Typed, read-only summary of what one retrain changed."""

    total_events: int
    events_by_type: dict[EventType, int]
    session_count: int
    popularity_movers: list[PopularityMover]
    changed_cooccurrence_edges: int
    current_version: str
    new_version: str
    schema_version: int


def build_audit_report(
    *,
    logs: list[SessionLog],
    before: list[Product],
    after: list[Product],
    before_cooccurrence: CooccurrenceMatrix,
    after_cooccurrence: CooccurrenceMatrix,
    current_version: str,
    new_version: str,
    schema_version: int,
    top_movers: int = DEFAULT_TOP_MOVERS,
) -> AuditReport:
    """Summarise the events and the catalog/co-occurrence diff a retrain produced."""
    by_type = _events_by_type(logs)
    return AuditReport(
        total_events=sum(by_type.values()),
        events_by_type=by_type,
        session_count=len(logs),
        popularity_movers=_movers(before, after, top_movers),
        changed_cooccurrence_edges=_changed_edges(before_cooccurrence, after_cooccurrence),
        current_version=current_version,
        new_version=new_version,
        schema_version=schema_version,
    )


def _events_by_type(logs: list[SessionLog]) -> dict[EventType, int]:
    """Count events per ``event_type`` across every session log."""
    counts: dict[EventType, int] = defaultdict(int)
    for log in logs:
        for event in log.events:
            counts[event.event_type] += 1
    return dict(counts)


def _movers(before: list[Product], after: list[Product], top: int) -> list[PopularityMover]:
    """Products whose popularity moved, biggest absolute Δ first, capped at ``top``."""
    prior = {p.id: p.popularity_score for p in before}
    movers = [
        PopularityMover(
            product_id=p.id,
            before=prior[p.id],
            after=p.popularity_score,
            delta=p.popularity_score - prior[p.id],
        )
        for p in after
        if p.id in prior and p.popularity_score != prior[p.id]
    ]
    movers.sort(key=lambda m: (-abs(m.delta), m.product_id))
    return movers[:top]


def _changed_edges(before: CooccurrenceMatrix, after: CooccurrenceMatrix) -> int:
    """Count co-occurrence neighbour edges that are new or rescored after retrain."""
    prior = {(pid, n.id): n.score for pid, ns in before.neighbors.items() for n in ns}
    changed = 0
    for pid, neighbors in after.neighbors.items():
        for neighbor in neighbors:
            if prior.get((pid, neighbor.id)) != neighbor.score:
                changed += 1
    return changed


def render_audit_table(report: AuditReport) -> str:
    """Render the typed report as a human-readable plain-text table."""
    lines = [
        f"Retrain audit: {report.current_version} -> {report.new_version} "
        f"(ranking_config schema v{report.schema_version})",
        f"Events: {report.total_events} across {report.session_count} sessions  "
        f"{_format_counts(report.events_by_type)}",
        f"Co-occurrence edges changed: {report.changed_cooccurrence_edges}",
        f"Top {len(report.popularity_movers)} popularity movers:",
    ]
    lines.extend(
        f"  {m.product_id:<14} {m.before:.3f} -> {m.after:.3f}  (Δ {m.delta:+.3f})"
        for m in report.popularity_movers
    )
    return "\n".join(lines)


def _format_counts(by_type: dict[EventType, int]) -> str:
    """Render the per-type event counts as ``[cart=1 click=2]``."""
    parts = " ".join(f"{event_type}={count}" for event_type, count in sorted(by_type.items()))
    return f"[{parts}]"
