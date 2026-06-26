"""/recommend pre-filters by popularity before rerank without changing top-N output."""

from __future__ import annotations

from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.models import Product


def _products(n: int) -> list[Product]:
    return [
        Product(id=f"p{i}", title=f"Product {i}", category="C", popularity_score=i / n)
        for i in range(n)
    ]


def test_recommend_top_n_stable_under_prefilter() -> None:
    client = TestClient(create_app(ServiceContainer.from_catalog(_products(50))))
    resp = client.get("/recommend?limit=5")
    assert resp.status_code == 200
    ids = [r["product"]["id"] for r in resp.json()["results"]]
    assert ids == [f"p{i}" for i in (49, 48, 47, 46, 45)]
