"""Unit tests for catalog manifest parsing.

``validate_checksum`` is gone (the content-addressed store verifies on read), so
only ``parse_manifest`` — the read-model behind ``/catalog/info`` — remains.
"""

from __future__ import annotations

import json
from pathlib import Path

from edgereco.catalog.manifest import parse_manifest


def test_parse_manifest_from_json(tmp_path: Path) -> None:
    data = {
        "catalog_id": "test",
        "version": "2026-01-01T00:00:00Z",
        "embedding_model": "all-MiniLM-L6-v2",
        "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(data))
    manifest = parse_manifest(manifest_path)
    assert manifest.catalog_id == "test"
    assert len(manifest.files) == 1
