"""Unit tests for HttpAdapter using httpx.MockTransport."""
from __future__ import annotations

from pathlib import Path

import httpx
import pytest

from edgereco.edge.adapters.http import HttpAdapter

_MANIFEST_DATA = {
    "catalog_id": "mock",
    "version": "v1",
    "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
    "embedding_dim": 384,
    "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
}


def test_fetch_manifest_returns_parsed_manifest() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_MANIFEST_DATA)

    adapter = HttpAdapter(transport=httpx.MockTransport(handler))
    manifest = adapter.fetch_manifest("http://example.com/manifest.json")

    assert manifest.catalog_id == "mock"
    assert manifest.version == "v1"
    assert manifest.embedding_dim == 384
    assert len(manifest.files) == 1
    assert manifest.files[0].path == "products.jsonl"


def test_fetch_manifest_raises_on_error_status() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404)

    adapter = HttpAdapter(transport=httpx.MockTransport(handler))
    with pytest.raises(httpx.HTTPStatusError):
        adapter.fetch_manifest("http://example.com/manifest.json")


def test_fetch_file_writes_content_to_local_path(tmp_path: Path) -> None:
    file_content = b'{"id": "p1", "title": "Test"}\n'

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=file_content)

    adapter = HttpAdapter(transport=httpx.MockTransport(handler))
    dest = tmp_path / "subdir" / "products.jsonl"
    adapter.fetch_file("http://example.com", "products.jsonl", dest)

    assert dest.exists()
    assert dest.read_bytes() == file_content


def test_fetch_file_raises_on_error_status(tmp_path: Path) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(403)

    adapter = HttpAdapter(transport=httpx.MockTransport(handler))
    dest = tmp_path / "products.jsonl"
    with pytest.raises(httpx.HTTPStatusError):
        adapter.fetch_file("http://example.com", "products.jsonl", dest)
