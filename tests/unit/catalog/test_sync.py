"""Unit tests for catalog sync."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from edgereco.catalog.sync import sync_catalog
from edgereco.edge.adapters.filesystem import FilesystemAdapter


def _setup_origin(tmp_path: Path) -> Path:
    origin = tmp_path / "origin"
    origin.mkdir()
    products = '{"id":"P1","title":"T","category":"C"}\n'
    (origin / "products.jsonl").write_text(products)
    checksum = "sha256:" + hashlib.sha256(products.encode()).hexdigest()
    manifest = {
        "catalog_id": "test", "version": "v1",
        "embedding_model": "model", "embedding_dim": 384,
        "files": [
            {"path": "products.jsonl", "file_type": "products", "checksum": checksum, "rows": 1},
        ],
    }
    (origin / "manifest.json").write_text(json.dumps(manifest))
    return origin


def test_sync_downloads_catalog(tmp_path: Path) -> None:
    origin = _setup_origin(tmp_path)
    cache = tmp_path / "cache"
    adapter = FilesystemAdapter()
    result = sync_catalog(
        manifest_url=str(origin / "manifest.json"),
        cache_dir=cache,
        client=adapter,
        file_base_url=str(origin),
    )
    assert result.catalog_id == "test"
    assert (cache / "products.jsonl").exists()


def test_sync_validates_checksum(tmp_path: Path) -> None:
    origin = _setup_origin(tmp_path)
    manifest = json.loads((origin / "manifest.json").read_text())
    manifest["files"][0]["checksum"] = "sha256:wrong"
    (origin / "manifest.json").write_text(json.dumps(manifest))
    cache = tmp_path / "cache"
    adapter = FilesystemAdapter()
    with pytest.raises(ValueError, match="checksum"):
        sync_catalog(
            manifest_url=str(origin / "manifest.json"),
            cache_dir=cache,
            client=adapter,
            file_base_url=str(origin),
        )
