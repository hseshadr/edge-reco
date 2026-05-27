from __future__ import annotations

from fastapi.testclient import TestClient

from demo.backend.main import app

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
