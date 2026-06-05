"""Unit tests for retrain republish helpers (pure parts)."""

import httpx
import pytest

from edgereco import republish
from edgereco.republish import bump_version


def test_bump_version_increments_trailing_integer() -> None:
    assert bump_version("v1") == "v2"
    assert bump_version("v9") == "v10"


def test_bump_version_increments_only_the_trailing_integer() -> None:
    assert bump_version("v1.2") == "v1.3"


def test_bump_version_appends_suffix_when_no_trailing_integer() -> None:
    # ISO-timestamp versions end in 'Z' (no trailing digit) — fall back to a suffix.
    assert bump_version("2026-04-24T00:00:00Z") == "2026-04-24T00:00:00Z-r2"


def test_fetch_engagement_parses_export(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = (
        '{"total_events": 3, "stats": ['
        '{"product_id": "P1", "event_count": 3, "weighted_score": 5.0}]}'
    )

    def fake_get(url: str, timeout: float) -> httpx.Response:
        return httpx.Response(200, text=payload, request=httpx.Request("GET", url))

    monkeypatch.setattr(republish.httpx, "get", fake_get)

    engagement = republish.fetch_engagement("http://collector/events/export")

    assert engagement["P1"].event_count == 3
    assert engagement["P1"].weighted_score == 5.0
