import json
from pathlib import Path

from edgereco.edge.adapters.filesystem import FilesystemAdapter


def test_fetch_manifest(tmp_path: Path) -> None:
    manifest_data = {
        "catalog_id": "test", "version": "v1",
        "embedding_model": "model", "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest_data))
    adapter = FilesystemAdapter()
    manifest = adapter.fetch_manifest(str(tmp_path / "manifest.json"))
    assert manifest.catalog_id == "test"


def test_fetch_file(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "data.txt").write_text("hello")
    dest = tmp_path / "dest" / "data.txt"
    adapter = FilesystemAdapter()
    adapter.fetch_file(str(source), "data.txt", dest)
    assert dest.read_text() == "hello"
