"""Append-only in-memory event buffer."""
from __future__ import annotations

from edgereco.catalog.models import InteractionEvent


class EventBuffer:
    """Thread-unsafe in-memory buffer for interaction events (v1: single process)."""

    def __init__(self) -> None:
        self._events: list[InteractionEvent] = []

    def append(self, event: InteractionEvent) -> None:
        self._events.append(event)

    def all(self) -> list[InteractionEvent]:
        return list(self._events)

    def __len__(self) -> int:
        return len(self._events)
