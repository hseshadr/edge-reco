"""Integration tests: GET /events/export — the retrain read seam.

The cloud retrain job pulls aggregated engagement from this endpoint, blends it
into popularity, and republishes the bundle. The endpoint aggregates the whole
in-memory event buffer, so tests assert on a dedicated synthetic product_id to
stay independent of events other tests post into the session-scoped container.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient


def _post(client: TestClient, product_id: str, event_type: str) -> None:
    client.post(
        "/events",
        json={
            "events": [
                {
                    "event_type": event_type,
                    "product_id": product_id,
                    "timestamp": "2026-06-05T00:00:00Z",
                }
            ]
        },
        headers={"X-Session-Id": str(uuid.uuid4())},
    )


def test_export_aggregates_weighted_engagement(client: TestClient) -> None:
    pid = "EXPORT_AGG_XYZ"
    _post(client, pid, "click")
    _post(client, pid, "favorite")

    response = client.get("/events/export")
    assert response.status_code == 200
    body = response.json()

    stat = next(s for s in body["stats"] if s["product_id"] == pid)
    assert stat["event_count"] == 2
    assert stat["weighted_score"] == 1.0 + 3.0  # click + favorite


def test_export_reports_total_event_count(client: TestClient) -> None:
    response = client.get("/events/export")
    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["total_events"], int)
    # total_events equals the sum of per-product event counts.
    assert body["total_events"] == sum(s["event_count"] for s in body["stats"])
