"""POST /events rejects unknown event_type values at the Pydantic boundary."""
from __future__ import annotations

from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.models import Product


def _client() -> TestClient:
    products = [Product(id="p1", title="t", category="c")]
    return TestClient(create_app(ServiceContainer.from_catalog(products)))


def test_unknown_event_type_is_rejected_with_422() -> None:
    client = _client()
    resp = client.post(
        "/events",
        json={
            "events": [
                {"event_type": "tap", "product_id": "p1", "timestamp": "2026-01-01T00:00:00Z"}
            ]
        },
    )
    assert resp.status_code == 422


def test_known_event_types_accepted() -> None:
    client = _client()
    for kind in ("click", "view", "favorite", "cart"):
        resp = client.post(
            "/events",
            json={
                "events": [
                    {"event_type": kind, "product_id": "p1", "timestamp": "2026-01-01T00:00:00Z"}
                ]
            },
        )
        assert resp.status_code == 200, f"{kind}: {resp.json()}"
