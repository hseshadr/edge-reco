"""Unit tests for EventBuffer."""
from __future__ import annotations

from edgereco.catalog.models import InteractionEvent
from edgereco.telemetry.buffer import EventBuffer


def _make_event(product_id: str = "p1") -> InteractionEvent:
    return InteractionEvent(
        product_id=product_id, event_type="click", timestamp="2026-01-01T00:00:00Z"
    )


def test_append_and_all_returns_events() -> None:
    buf = EventBuffer()
    e1 = _make_event("p1")
    e2 = _make_event("p2")
    buf.append(e1)
    buf.append(e2)

    events = buf.all()
    assert len(events) == 2
    assert events[0].product_id == "p1"
    assert events[1].product_id == "p2"


def test_all_returns_copy_not_reference() -> None:
    buf = EventBuffer()
    buf.append(_make_event("p1"))

    snapshot = buf.all()
    snapshot.clear()

    assert len(buf.all()) == 1


def test_len_reflects_buffer_size() -> None:
    buf = EventBuffer()
    assert len(buf) == 0

    buf.append(_make_event("p1"))
    assert len(buf) == 1

    buf.append(_make_event("p2"))
    assert len(buf) == 2
