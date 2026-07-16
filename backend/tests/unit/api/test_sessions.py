"""Bounded-retention behavior for the in-memory API session store."""

from __future__ import annotations

import pytest

from edgereco.api.sessions import SessionStore


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def test_session_store_evicts_the_least_recently_used_session() -> None:
    store = SessionStore(max_sessions=2)
    first = store.get("first")
    second = store.get("second")

    assert store.get("first") is first
    store.get("third")

    assert store.size == 2
    assert store.get("second") is not second


def test_session_store_expires_idle_profiles() -> None:
    clock = FakeClock()
    store = SessionStore(ttl_seconds=60.0, clock=clock)
    original = store.get("visitor")

    clock.advance(60.0)

    assert store.get("visitor") is not original
    assert store.size == 1


@pytest.mark.parametrize(("keyword", "value"), [("max_sessions", 0), ("ttl_seconds", 0.0)])
def test_session_store_rejects_unbounded_configuration(keyword: str, value: int | float) -> None:
    with pytest.raises(ValueError, match=keyword):
        SessionStore(**{keyword: value})
