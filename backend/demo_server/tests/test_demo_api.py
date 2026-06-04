from __future__ import annotations

from fastapi.testclient import TestClient

from demo_server.main import app

client = TestClient(app)


def test_healthz_ok() -> None:
    assert client.get("/healthz").status_code == 200


def test_cors_header_present_for_browser_origin() -> None:
    r = client.get("/healthz", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_search_then_click_then_recommend_personalizes() -> None:
    sid = {"X-Session-Id": "demo-test-1"}
    hits = client.get("/search", params={"q": "headphones", "limit": 5}).json()["results"]
    assert hits
    pid = hits[0]["product"]["id"]
    event = {"event_type": "click", "product_id": pid, "timestamp": "2026-05-26T00:00:00Z"}
    client.post("/events", json={"events": [event]}, headers=sid)
    rec = client.get("/recommend", params={"limit": 10}, headers=sid).json()
    assert rec["session_clicks"] >= 1
    assert rec["results"][0]["score_components"] is not None


def test_events_collector_records_batch_with_cors() -> None:
    """The mimicked-cloud collector accepts a batched uplink from the SPA origin."""
    headers = {"X-Session-Id": "collector-batch", "Origin": "http://localhost:5173"}
    events = [
        {"event_type": "click", "product_id": "p-unknown-1", "timestamp": "2026-06-04T00:00:00Z"},
        {"event_type": "view", "product_id": "p-unknown-2", "timestamp": "2026-06-04T00:00:01Z"},
    ]
    r = client.post("/events", json={"events": events}, headers=headers)
    assert r.status_code == 200
    assert r.json()["received"] == 2  # unknown ids are tolerated, still recorded
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_events_body_session_id_attributes_without_header() -> None:
    """sendBeacon can't set headers, so the body's session_id must drive attribution."""
    hits = client.get("/search", params={"q": "headphones", "limit": 1}).json()["results"]
    pid = hits[0]["product"]["id"]
    event = {"event_type": "click", "product_id": pid, "timestamp": "2026-06-04T00:00:00Z"}
    # No X-Session-Id header — only the body carries the session id (the beacon path).
    client.post("/events", json={"events": [event], "session_id": "beacon-only-sess"})
    rec = client.get(
        "/recommend", params={"limit": 10}, headers={"X-Session-Id": "beacon-only-sess"}
    ).json()
    assert rec["session_clicks"] >= 1


def test_browse_products_paginates_and_lists_categories() -> None:
    body = client.get("/products", params={"limit": 12}).json()
    assert len(body["products"]) == 12
    assert body["total"] >= 12
    assert body["categories"]  # non-empty facet list


def test_browse_filters_by_category() -> None:
    category = client.get("/products", params={"limit": 1}).json()["categories"][0]
    body = client.get("/products", params={"category": category, "limit": 50}).json()
    assert body["products"]
    assert all(p["category"] == category for p in body["products"])
