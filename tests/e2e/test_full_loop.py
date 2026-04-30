"""End-to-end test: sync → index → search → click → recommend."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.manifest import parse_manifest
from edgereco.catalog.sync import sync_catalog
from edgereco.edge.adapters.filesystem import FilesystemAdapter

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture(scope="module")
def origin_dir(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Stand up a synthetic 'origin' directory with manifest + products.jsonl + checksum."""
    origin = tmp_path_factory.mktemp("origin")
    shutil.copy2(FIXTURES_DIR / "mini_catalog.jsonl", origin / "products.jsonl")

    import hashlib

    products_bytes = (origin / "products.jsonl").read_bytes()
    checksum = "sha256:" + hashlib.sha256(products_bytes).hexdigest()
    manifest = {
        "catalog_id": "e2e-origin",
        "version": "v1",
        "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
        "embedding_dim": 384,
        "files": [
            {
                "path": "products.jsonl",
                "file_type": "products",
                "checksum": checksum,
                "rows": 50,
            }
        ],
    }
    (origin / "manifest.json").write_text(json.dumps(manifest))
    return origin


@pytest.fixture(scope="module")
def synced_cache(origin_dir: Path, tmp_path_factory: pytest.TempPathFactory) -> Path:
    """Sync the origin into a fresh cache via FilesystemAdapter."""
    cache = tmp_path_factory.mktemp("cache")
    sync_catalog(
        manifest_url=str(origin_dir / "manifest.json"),
        cache_dir=cache,
        client=FilesystemAdapter(),
        file_base_url=str(origin_dir),
    )
    return cache


@pytest.fixture(scope="module")
def container(synced_cache: Path) -> ServiceContainer:
    """Build a ServiceContainer from the synced cache (loads encoder + indexes)."""
    products = load_jsonl(synced_cache / "products.jsonl")
    manifest = parse_manifest(synced_cache / "manifest.json")
    return ServiceContainer.from_catalog(products, manifest=manifest)


@pytest.fixture(scope="module")
def client(container: ServiceContainer) -> TestClient:
    app = create_app(container)
    return TestClient(app)


@pytest.mark.e2e
def test_full_discovery_loop(client: TestClient) -> None:
    # 1. Health check
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    # 2. Catalog info reflects synced manifest
    info = client.get("/catalog/info")
    assert info.status_code == 200
    body = info.json()
    assert body["catalog_id"] == "e2e-origin"
    assert body["product_count"] == 50

    # 3. Search returns hybrid+reranked results for a real query
    search = client.get("/search", params={"q": "wireless bluetooth headphones", "limit": 10})
    assert search.status_code == 200
    payload = search.json()
    assert payload["query"] == "wireless bluetooth headphones"
    assert payload["total"] >= 1
    result_ids = [r["product"]["id"] for r in payload["results"]]
    assert "B001" in result_ids  # Wireless Bluetooth Headphones in mini_catalog

    # 4. Empty session: recommend returns 50 products in some order
    rec_initial = client.get(
        "/recommend",
        params={"limit": 50},
        headers={"X-Session-Id": "e2e-session-1"},
    )
    assert rec_initial.status_code == 200
    assert len(rec_initial.json()["results"]) == 50

    # 5. Click 3 Electronics products via /events
    electronics_clicks: list[dict[str, Any]] = [
        {
            "event_type": "click",
            "product_id": pid,
            "timestamp": "2026-04-30T00:00:00Z",
            "metadata": {},
        }
        for pid in ("B001", "B006", "B007")
    ]
    events = client.post(
        "/events",
        json={"events": electronics_clicks},
        headers={"X-Session-Id": "e2e-session-1"},
    )
    assert events.status_code == 200
    assert events.json() == {"received": 3}

    # 6. Recommend after clicks: top results should now lean Electronics
    rec_after = client.get(
        "/recommend",
        params={"limit": 50},
        headers={"X-Session-Id": "e2e-session-1"},
    )
    assert rec_after.status_code == 200
    after_results = rec_after.json()["results"]
    after_top_5 = after_results[:5]
    after_top_ids = [r["product"]["id"] for r in after_top_5]

    # The top-5 should now contain at least one Electronics product that wasn't there before,
    # OR the proportion of Electronics in the top-5 should increase.
    after_categories = [r["product"]["category"] for r in after_top_5]
    electronics_count_after = sum(1 for c in after_categories if c == "Electronics")
    assert electronics_count_after >= 2, (
        f"Expected ≥2 Electronics in top 5 after Electronics clicks; "
        f"got {electronics_count_after} from {after_top_ids}"
    )

    # 7. session_clicks reflects the 3 clicks
    assert rec_after.json()["session_clicks"] == 3

    # 8. Repetition penalty: B001 was clicked, should NOT be the top reranked recommendation
    # (the scorer penalizes recently_viewed by 0.25)
    assert after_top_ids[0] != "B001"
