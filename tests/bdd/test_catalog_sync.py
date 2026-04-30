"""Step impls for features/catalog_sync.feature."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

import pytest
from pytest_bdd import given, scenarios, then, when

from edgereco.catalog.sync import sync_catalog
from edgereco.edge.adapters.filesystem import FilesystemAdapter

scenarios("catalog_sync.feature")


@pytest.fixture
def ctx(tmp_path: Path) -> dict[str, Any]:
    return {"tmp_path": tmp_path}


def _seed_origin(ctx: dict[str, Any], *, corrupt_checksum: bool) -> None:
    origin = ctx["tmp_path"] / "origin"
    origin.mkdir()
    products = '{"id":"P1","title":"T","category":"C"}\n'
    (origin / "products.jsonl").write_text(products)
    checksum = "sha256:" + hashlib.sha256(products.encode()).hexdigest()
    if corrupt_checksum:
        checksum = "sha256:wrong"
    manifest = {
        "catalog_id": "bdd-origin", "version": "v1",
        "embedding_model": "model", "embedding_dim": 384,
        "files": [
            {"path": "products.jsonl", "file_type": "products", "checksum": checksum, "rows": 1},
        ],
    }
    (origin / "manifest.json").write_text(json.dumps(manifest))
    ctx["origin"] = origin


@given("an origin with a 1-product catalog and a valid checksum")
def _origin_valid(ctx: dict[str, Any]) -> None:
    _seed_origin(ctx, corrupt_checksum=False)


@given("an origin with a 1-product catalog and a corrupted checksum")
def _origin_corrupt(ctx: dict[str, Any]) -> None:
    _seed_origin(ctx, corrupt_checksum=True)


@when("I sync the catalog into a fresh cache directory")
def _sync(ctx: dict[str, Any]) -> None:
    cache = ctx["tmp_path"] / "cache"
    ctx["manifest"] = sync_catalog(
        manifest_url=str(ctx["origin"] / "manifest.json"),
        cache_dir=cache,
        client=FilesystemAdapter(),
        file_base_url=str(ctx["origin"]),
    )
    ctx["cache"] = cache


@when("I attempt to sync the catalog")
def _attempt_sync(ctx: dict[str, Any]) -> None:
    cache = ctx["tmp_path"] / "cache"
    try:
        sync_catalog(
            manifest_url=str(ctx["origin"] / "manifest.json"),
            cache_dir=cache,
            client=FilesystemAdapter(),
            file_base_url=str(ctx["origin"]),
        )
    except ValueError as e:
        ctx["error"] = e
    ctx["cache"] = cache


@then("the local cache should contain the product file")
def _cache_has_file(ctx: dict[str, Any]) -> None:
    assert (ctx["cache"] / "products.jsonl").exists()


@then("the synced manifest catalog_id should match the origin")
def _catalog_id_match(ctx: dict[str, Any]) -> None:
    assert ctx["manifest"].catalog_id == "bdd-origin"


@then("a checksum validation error is raised")
def _error_raised(ctx: dict[str, Any]) -> None:
    err = ctx.get("error")
    assert isinstance(err, ValueError)
    assert "checksum" in str(err).lower()
