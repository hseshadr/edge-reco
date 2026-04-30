"""Integration tests: /search endpoint."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_search_returns_electronics_for_headphones(client: TestClient) -> None:
    response = client.get("/search?q=wireless%20bluetooth%20headphones")
    assert response.status_code == 200
    body = response.json()
    assert len(body["results"]) >= 1
    assert body["query"] == "wireless bluetooth headphones"
    categories = [r["product"]["category"] for r in body["results"]]
    assert "Electronics" in categories


def test_search_b001_in_top_10_for_headphones(client: TestClient) -> None:
    response = client.get("/search?q=wireless%20bluetooth%20headphones")
    body = response.json()
    # B001 is a direct title match; may not be in top-5 after reranking by
    # popularity/freshness but should be in the default limit=10 results.
    all_ids = [r["product"]["id"] for r in body["results"]]
    assert "B001" in all_ids


def test_search_category_filter(client: TestClient) -> None:
    response = client.get("/search?q=running&category=Clothing")
    assert response.status_code == 200
    body = response.json()
    assert all(r["product"]["category"] == "Clothing" for r in body["results"])


def test_search_empty_query_returns_empty(client: TestClient) -> None:
    response = client.get("/search?q=")
    assert response.status_code == 200
    body = response.json()
    assert body["results"] == []
    assert body["query"] == ""
    assert body["total"] == 0
