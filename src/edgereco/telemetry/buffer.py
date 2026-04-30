"""Capped in-memory event buffer."""
from __future__ import annotations

from collections import deque

from edgereco.catalog.models import InteractionEvent

EVENT_BUFFER_MAXLEN = 10_000


class EventBuffer:
    """Thread-unsafe single-process ring buffer for interaction events."""

    def __init__(self, maxlen: int = EVENT_BUFFER_MAXLEN) -> None:
        self._events: deque[InteractionEvent] = deque(maxlen=maxlen)

    def append(self, event: InteractionEvent) -> None:
        self._events.append(event)

    def all(self) -> list[InteractionEvent]:
        return list(self._events)

    def __len__(self) -> int:
        return len(self._events)
