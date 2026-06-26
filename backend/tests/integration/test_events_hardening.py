"""Integration tests: demo ``/events`` collector hardening.

Two protections guard the mimicked-cloud collector, both off the inference path:

* a Pydantic ``max_length`` cap on the events batch (oversized payloads → 422), and
* an OPTIONAL fail-closed shared-key guard read from ``EDGERECO_EVENTS_TOKEN``.

The guard is unset by default so ``poe demo-flywheel`` / ``poe demo-retrain`` keep
working tokenless; when set, both ``/events`` and ``/events/export`` require a
matching ``Authorization: Bearer <token>``.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.api.routes.events import MAX_EVENTS_PER_BATCH
from edgereco.catalog.models import Product


def _client() -> TestClient:
    # Given a fresh app over a one-product catalog (no shared session-scoped state).
    products = [Product(id="p1", title="t", category="c")]
    return TestClient(create_app(ServiceContainer.from_catalog(products)))


def _event(product_id: str = "p1") -> dict[str, str]:
    return {
        "event_type": "click",
        "product_id": product_id,
        "timestamp": "2026-01-01T00:00:00Z",
    }


def test_should_reject_over_cap_batch_with_422() -> None:
    # Given a batch one event larger than the cap
    client = _client()
    payload = {"events": [_event() for _ in range(MAX_EVENTS_PER_BATCH + 1)]}
    # When it is posted
    response = client.post("/events", json=payload)
    # Then the Pydantic boundary rejects it
    assert response.status_code == 422


def test_should_accept_batch_exactly_at_cap() -> None:
    # Given a batch exactly at the cap
    client = _client()
    payload = {"events": [_event() for _ in range(MAX_EVENTS_PER_BATCH)]}
    # When it is posted
    response = client.post("/events", json=payload)
    # Then it is accepted and every event is counted
    assert response.status_code == 200
    assert response.json() == {"received": MAX_EVENTS_PER_BATCH}


def test_should_leave_events_open_when_token_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given no shared key configured (the default demo path)
    monkeypatch.delenv("EDGERECO_EVENTS_TOKEN", raising=False)
    client = _client()
    # When /events is posted with no Authorization header
    response = client.post("/events", json={"events": [_event()]})
    # Then it is accepted (tokenless demo keeps working)
    assert response.status_code == 200


def test_should_leave_export_open_when_token_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given no shared key configured
    monkeypatch.delenv("EDGERECO_EVENTS_TOKEN", raising=False)
    client = _client()
    # When /events/export is read with no Authorization header
    response = client.get("/events/export")
    # Then it is accepted
    assert response.status_code == 200


def test_should_allow_events_with_correct_token(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a shared key configured
    monkeypatch.setenv("EDGERECO_EVENTS_TOKEN", "s3cret")
    client = _client()
    # When /events is posted with the matching bearer token
    response = client.post(
        "/events",
        json={"events": [_event()]},
        headers={"Authorization": "Bearer s3cret"},
    )
    # Then it is accepted
    assert response.status_code == 200


def test_should_allow_export_with_correct_token(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a shared key configured
    monkeypatch.setenv("EDGERECO_EVENTS_TOKEN", "s3cret")
    client = _client()
    # When /events/export is read with the matching bearer token
    response = client.get("/events/export", headers={"Authorization": "Bearer s3cret"})
    # Then it is accepted
    assert response.status_code == 200


def test_should_reject_events_when_token_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a shared key configured
    monkeypatch.setenv("EDGERECO_EVENTS_TOKEN", "s3cret")
    client = _client()
    # When /events is posted with no Authorization header
    response = client.post("/events", json={"events": [_event()]})
    # Then it is rejected fail-closed
    assert response.status_code == 401


def test_should_reject_events_when_token_wrong(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a shared key configured
    monkeypatch.setenv("EDGERECO_EVENTS_TOKEN", "s3cret")
    client = _client()
    # When /events is posted with a mismatched bearer token
    response = client.post(
        "/events",
        json={"events": [_event()]},
        headers={"Authorization": "Bearer wrong"},
    )
    # Then it is rejected
    assert response.status_code == 401


def test_should_reject_export_when_token_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given a shared key configured
    monkeypatch.setenv("EDGERECO_EVENTS_TOKEN", "s3cret")
    client = _client()
    # When /events/export is read with no Authorization header
    response = client.get("/events/export")
    # Then it is rejected fail-closed
    assert response.status_code == 401
