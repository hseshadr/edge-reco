"""EventBuffer drops oldest events past maxlen."""
from __future__ import annotations

from edgereco.catalog.models import InteractionEvent
from edgereco.telemetry.buffer import EVENT_BUFFER_MAXLEN, EventBuffer


def _ev(i: int) -> InteractionEvent:
    return InteractionEvent(event_type="view", product_id=f"p{i}", timestamp="t")


def test_buffer_caps_at_maxlen() -> None:
    buf = EventBuffer(maxlen=4)
    for i in range(7):
        buf.append(_ev(i))
    assert len(buf) == 4
    assert buf.all()[0].product_id == "p3"
    assert buf.all()[-1].product_id == "p6"


def test_default_maxlen_constant() -> None:
    assert EVENT_BUFFER_MAXLEN == 10_000
    buf = EventBuffer()
    assert len(buf) == 0
