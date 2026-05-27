"""Unit tests for the bundle PRODUCER (edge-proc ``build_bundle`` wrapper).

A tiny synthetic staging dir stands in for a real built catalog (no model
download): a small ``products.jsonl`` plus a ``vector/`` dir of dummy bytes. The
producer is content-agnostic, so dummy FAISS artifacts exercise the full path.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from edgeproc.bundles.adapters import FilesystemAdapter
from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.signing import (
    Ed25519Verifier,
    SignatureError,
    generate_keypair,
)
from edgeproc.bundles.sync import materialize_file, sync_index
from typer.testing import CliRunner

from edgereco.catalog.publish import BUNDLE_FILES, publish_bundle
from edgereco.cli import app

runner = CliRunner()

_PRODUCTS = '{"id":"P1","title":"Widget","category":"Electronics"}\n'
_FAISS_INDEX = b"\x00FAISS-INDEX-BYTES\x01"
_FAISS_STATE = b'{"id_map": ["P1"]}'


def _staging(tmp_path: Path) -> Path:
    """A tiny built-catalog staging dir: products.jsonl + vector/<dummy files>."""
    staging = tmp_path / "staging"
    (staging / "vector").mkdir(parents=True)
    (staging / "products.jsonl").write_text(_PRODUCTS, encoding="utf-8")
    (staging / "vector" / "index.faiss").write_bytes(_FAISS_INDEX)
    (staging / "vector" / "state.json").write_bytes(_FAISS_STATE)
    return staging


def test_produces_consumable_signed_origin(tmp_path: Path) -> None:
    staging = _staging(tmp_path)
    origin = tmp_path / "origin"
    private, public = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="amazon-demo",
        version="2026-05-27T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = cache._load_manifest(cache.read_active().manifest_hash)  # type: ignore[union-attr]

    assert materialize_file(cache, manifest, "products.jsonl") == _PRODUCTS.encode("utf-8")
    assert materialize_file(cache, manifest, "vector/index.faiss") == _FAISS_INDEX
    assert materialize_file(cache, manifest, "vector/state.json") == _FAISS_STATE
    meta = json.loads(materialize_file(cache, manifest, "catalog_meta.json"))
    assert {"products.jsonl", "vector/index.faiss", "vector/state.json", "catalog_meta.json"} == {
        entry.path for entry in manifest.files
    }
    assert meta["catalog_id"] == "amazon-demo"


def test_catalog_meta_content(tmp_path: Path) -> None:
    staging = _staging(tmp_path)
    origin = tmp_path / "origin"
    private, public = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="amazon-demo",
        version="2026-05-27T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = cache._load_manifest(cache.read_active().manifest_hash)  # type: ignore[union-attr]
    meta = json.loads(materialize_file(cache, manifest, "catalog_meta.json"))

    assert meta == {
        "catalog_id": "amazon-demo",
        "version": "2026-05-27T00:00:00Z",
        "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
        "embedding_dim": 384,
        "product_count": 1,
    }


def test_bundle_files_contract() -> None:
    assert BUNDLE_FILES == ("products.jsonl", "vector", "catalog_meta.json")


def test_signature_fail_closed(tmp_path: Path) -> None:
    staging = _staging(tmp_path)
    origin = tmp_path / "origin"
    private, _ = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="amazon-demo",
        version="v1",
        embedding_model="m",
        embedding_dim=384,
        product_count=1,
    )

    _, wrong_public = generate_keypair()  # different keypair
    cache = FilesystemCacheStore(tmp_path / "cache")
    with pytest.raises(SignatureError):
        sync_index(
            base_url=str(origin),
            store=cache,
            adapter=FilesystemAdapter(),
            verifier=Ed25519Verifier(wrong_public),
        )


def test_cli_bundle_end_to_end(tmp_path: Path) -> None:
    staging = _staging(tmp_path)
    origin = tmp_path / "origin"
    private, public = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    result = runner.invoke(
        app,
        [
            "bundle",
            str(staging),
            str(origin),
            str(key_path),
            "--catalog-id",
            "amazon-demo",
            "--version",
            "v1",
            "--embedding-model",
            "sentence-transformers/all-MiniLM-L6-v2",
            "--embedding-dim",
            "384",
            "--product-count",
            "1",
        ],
    )

    assert result.exit_code == 0, result.output
    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    assert cache.read_active() is not None
