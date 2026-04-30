"""Integration tests: /catalog/info endpoint."""
from __future__ import annotations

from fastapi.testclient import TestClient


def test_catalog_info_product_count(client: TestClient) -> None:
    response = client.get("/catalog/info")
    assert response.status_code == 200
    body = response.json()
    assert body["product_count"] == 50


def test_catalog_info_structure(client: TestClient) -> None:
    response = client.get("/catalog/info")
    body = response.json()
    assert "catalog_id" in body
    assert "version" in body
    assert "index_stats" in body
    stats = body["index_stats"]
    assert stats["keyword_corpus_size"] == 50
    assert stats["vector_index_size"] == 50
