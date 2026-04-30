import hashlib
import json
from pathlib import Path

from edgereco.catalog.manifest import parse_manifest, validate_checksum


def test_parse_manifest_from_json(tmp_path: Path) -> None:
    data = {
        "catalog_id": "test", "version": "2026-01-01T00:00:00Z",
        "embedding_model": "all-MiniLM-L6-v2", "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(data))
    manifest = parse_manifest(manifest_path)
    assert manifest.catalog_id == "test"
    assert len(manifest.files) == 1


def test_validate_checksum_passes(tmp_path: Path) -> None:
    file_path = tmp_path / "test.txt"
    file_path.write_text("hello")
    expected = "sha256:" + hashlib.sha256(b"hello").hexdigest()
    assert validate_checksum(file_path, expected) is True


def test_validate_checksum_fails(tmp_path: Path) -> None:
    file_path = tmp_path / "test.txt"
    file_path.write_text("hello")
    assert validate_checksum(file_path, "sha256:wrong") is False
