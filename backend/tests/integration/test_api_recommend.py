"""Integration tests: /recommend endpoint."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_recommend_returns_requested_limit(client: TestClient) -> None:
    response = client.get("/recommend?limit=5")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) == 5
    assert "session_clicks" in body


def test_recommend_session_clicks_zero_for_new_session(client: TestClient) -> None:
    response = client.get("/recommend?limit=5", headers={"X-Session-Id": "fresh-session-xyz"})
    assert response.status_code == 200
    assert response.json()["session_clicks"] == 0
