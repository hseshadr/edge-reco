from pathlib import Path

from fastapi.testclient import TestClient

from app.domain.catalog import load_catalog
from app.main import create_app

FIXTURE = Path(__file__).parent / "fixtures" / "mini_catalog.json"


def _client() -> TestClient:
    return TestClient(create_app(catalog=load_catalog(FIXTURE)))


def test_healthz_returns_ok() -> None:
    resp = _client().get("/v0/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_catalog_endpoint_returns_all_items() -> None:
    resp = _client().get("/v0/catalog")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 3
    assert "generatedAt" in body  # camelCase in JSON thanks to aliases


def test_candidates_endpoint_sorts_by_popularity() -> None:
    resp = _client().post(
        "/v0/candidates",
        json={"contextType": "homepage", "limit": 10},
    )
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert ids == ["b", "a", "c"]


def test_candidates_endpoint_respects_category_hint() -> None:
    resp = _client().post(
        "/v0/candidates",
        json={"contextType": "homepage", "categoryHint": "running", "limit": 10},
    )
    assert resp.status_code == 200
    ids = [item["id"] for item in resp.json()["items"]]
    assert set(ids) == {"a", "c"}


def test_events_endpoint_accepts_batch() -> None:
    resp = _client().post(
        "/v0/events",
        json={
            "events": [
                {
                    "eventId": "e1",
                    "eventType": "click",
                    "itemId": "a",
                    "timestamp": "2026-04-11T00:00:00Z",
                    "contextType": "homepage",
                }
            ]
        },
    )
    assert resp.status_code == 202
    assert resp.json() == {"received": 1}
