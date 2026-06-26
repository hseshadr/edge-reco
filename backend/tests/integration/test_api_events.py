"""Integration tests: POST /events endpoint."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def test_post_events_returns_received_count(client: TestClient) -> None:
    session_id = str(uuid.uuid4())
    payload = {
        "events": [
            {"event_type": "click", "product_id": "B001", "timestamp": "2026-04-26T00:00:00Z"},
        ]
    }
    response = client.post("/events", json=payload, headers={"X-Session-Id": session_id})
    assert response.status_code == 200
    assert response.json() == {"received": 1}


def test_post_events_unknown_product_id_still_200(client: TestClient) -> None:
    session_id = str(uuid.uuid4())
    payload = {
        "events": [
            {
                "event_type": "click",
                "product_id": "UNKNOWN_XYZ",
                "timestamp": "2026-04-26T00:00:00Z",
            },
        ]
    }
    response = client.post("/events", json=payload, headers={"X-Session-Id": session_id})
    assert response.status_code == 200
    assert response.json() == {"received": 1}


def test_post_events_affinity_shifts_recommend(client: TestClient) -> None:
    """After clicking an Electronics product, Electronics should rank higher in recommend."""
    session_id = str(uuid.uuid4())

    # Baseline: top category before any clicks
    before = client.get("/recommend?limit=10", headers={"X-Session-Id": session_id})
    before_cats = [r["product"]["category"] for r in before.json()["results"]]

    # Click Electronics products multiple times to build strong affinity
    payload = {
        "events": [
            {"event_type": "click", "product_id": pid, "timestamp": "2026-04-26T00:00:00Z"}
            for pid in ["B001", "B006", "B007", "B008", "B009"]
        ]
    }
    client.post("/events", json=payload, headers={"X-Session-Id": session_id})

    after = client.get("/recommend?limit=10", headers={"X-Session-Id": session_id})
    after_body = after.json()
    after_cats = [r["product"]["category"] for r in after_body["results"]]

    # Session clicks should reflect the 5 click events
    assert after_body["session_clicks"] == 5

    # Electronics should appear more prominently after clicking 5 Electronics products
    electronics_count_after = after_cats.count("Electronics")
    electronics_count_before = before_cats.count("Electronics")
    assert electronics_count_after > electronics_count_before


def test_post_multiple_events_received_count(client: TestClient) -> None:
    session_id = str(uuid.uuid4())
    payload = {
        "events": [
            {"event_type": "click", "product_id": "B001", "timestamp": "2026-04-26T00:00:00Z"},
            {"event_type": "view", "product_id": "B002", "timestamp": "2026-04-26T00:00:01Z"},
        ]
    }
    response = client.post("/events", json=payload, headers={"X-Session-Id": session_id})
    assert response.status_code == 200
    assert response.json() == {"received": 2}


def test_post_events_accepts_all_event_types(client: TestClient) -> None:
    """The collector accepts the full vocabulary the SPA emits as of v0.9.0."""
    session_id = str(uuid.uuid4())
    payload = {
        "events": [
            {"event_type": et, "product_id": "B001", "timestamp": "2026-06-11T00:00:00Z"}
            for et in ["click", "view", "favorite", "cart"]
        ]
    }
    response = client.post("/events", json=payload, headers={"X-Session-Id": session_id})
    assert response.status_code == 200
    assert response.json() == {"received": 4}
