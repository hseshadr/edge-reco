"""Domain types — plain @dataclass, NO Pydantic, NO FastAPI imports."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DomainItem:
    id: str
    title: str
    category: str
    tags: tuple[str, ...]
    popularity_score: float
    freshness_score: float


@dataclass(frozen=True)
class DomainCandidateContext:
    context_type: str
    category_hint: str | None
    limit: int


@dataclass(frozen=True)
class DomainEvent:
    event_id: str
    event_type: str
    item_id: str
    timestamp: str
    context_type: str


@dataclass(frozen=True)
class DomainEventBatch:
    events: tuple[DomainEvent, ...] = field(default_factory=tuple)
