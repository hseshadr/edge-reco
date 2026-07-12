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
from edgeproc.bundles.manifest import IndexManifest
from edgeproc.bundles.signing import (
    Ed25519Verifier,
    SignatureError,
    generate_keypair,
)
from edgeproc.bundles.sync import materialize_file, sync_index
from typer.testing import CliRunner

from edgereco.catalog.publish import BUNDLE_FILES, CURRENT_META_SCHEMA, publish_bundle
from edgereco.cli import app
from edgereco.reco.cooccurrence import CooccurrenceMatrix, Neighbor
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, RankingConfig

runner = CliRunner()

_PRODUCTS = '{"id":"P1","title":"Widget","category":"Electronics"}\n'
_FAISS_INDEX = b"\x00FAISS-INDEX-BYTES\x01"
_FAISS_STATE = b'{"id_map": ["P1"]}'
_EMBEDDINGS = b"\x00\x00\x80\x3f" * 4  # 4 float32 1.0s — opaque to the producer


def _staging(tmp_path: Path) -> Path:
    """A tiny built-catalog staging dir: products.jsonl + vector/<dummy files>."""
    staging = tmp_path / "staging"
    (staging / "vector").mkdir(parents=True)
    (staging / "products.jsonl").write_text(_PRODUCTS, encoding="utf-8")
    (staging / "vector" / "index.faiss").write_bytes(_FAISS_INDEX)
    (staging / "vector" / "state.json").write_bytes(_FAISS_STATE)
    (staging / "vector" / "embeddings.f32").write_bytes(_EMBEDDINGS)
    return staging


def _active_manifest(cache: FilesystemCacheStore) -> IndexManifest:
    """Load the manifest for the store's freshly-promoted active pointer."""
    pointer = cache.read_active()
    assert pointer is not None  # sync_index promotes an active version or raises
    return cache._load_manifest(pointer.manifest_hash)


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
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)

    assert materialize_file(cache, manifest, "products.jsonl") == _PRODUCTS.encode("utf-8")
    assert materialize_file(cache, manifest, "vector/index.faiss") == _FAISS_INDEX
    assert materialize_file(cache, manifest, "vector/state.json") == _FAISS_STATE
    assert materialize_file(cache, manifest, "vector/embeddings.f32") == _EMBEDDINGS
    meta = json.loads(materialize_file(cache, manifest, "catalog_meta.json"))
    assert {
        "products.jsonl",
        "vector/index.faiss",
        "vector/state.json",
        "vector/embeddings.f32",
        "catalog_meta.json",
        "ranking_config.json",
        "cooccurrence.json",
    } == {entry.path for entry in manifest.files}
    assert meta["catalog_id"] == "amazon-demo"


def test_bundle_carries_signed_cooccurrence(tmp_path: Path) -> None:
    """A built bundle contains a signed ``cooccurrence.json`` that round-trips; an
    empty matrix is the default when the staging dir provides none."""
    staging = _staging(tmp_path)
    cooc = CooccurrenceMatrix(neighbors={"P1": [Neighbor(id="P2", score=0.42)]})
    (staging / "cooccurrence.json").write_text(cooc.model_dump_json(), encoding="utf-8")
    origin = tmp_path / "origin"
    private, public = generate_keypair()
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
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    raw = materialize_file(cache, manifest, "cooccurrence.json")
    assert CooccurrenceMatrix.model_validate_json(raw) == cooc


def test_bundle_defaults_empty_cooccurrence_when_absent(tmp_path: Path) -> None:
    """A staging dir with no ``cooccurrence.json`` gets an empty matrix (older bundles)."""
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
        version="v1",
        embedding_model="m",
        embedding_dim=384,
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    raw = materialize_file(cache, manifest, "cooccurrence.json")
    assert CooccurrenceMatrix.model_validate_json(raw) == CooccurrenceMatrix()


def test_bundle_carries_signed_ranking_config(tmp_path: Path) -> None:
    """A built bundle contains a signed ``ranking_config.json`` that round-trips
    to ``DEFAULT_RANKING_CONFIG`` when the staging dir provides none."""
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
        version="v1",
        embedding_model="m",
        embedding_dim=384,
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    raw = materialize_file(cache, manifest, "ranking_config.json")
    assert RankingConfig.model_validate_json(raw) == DEFAULT_RANKING_CONFIG


def test_bundle_preserves_staged_ranking_config(tmp_path: Path) -> None:
    """When the staging dir already carries a ranking_config.json (e.g. a retrain
    re-staging a synced bundle), the producer keeps it verbatim, not the default."""
    staging = _staging(tmp_path)
    tuned = DEFAULT_RANKING_CONFIG.model_copy(deep=True)
    tuned.scoring_weights.popularity = 0.55
    (staging / "ranking_config.json").write_text(tuned.model_dump_json(), encoding="utf-8")
    origin = tmp_path / "origin"
    private, public = generate_keypair()
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
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    raw = materialize_file(cache, manifest, "ranking_config.json")
    restored = RankingConfig.model_validate_json(raw)
    assert restored == tuned
    assert restored != DEFAULT_RANKING_CONFIG


def test_catalog_meta_carries_current_schema_version(tmp_path: Path) -> None:
    """A freshly published bundle stamps the current meta schema_version, so a
    consumer can tell a current bundle from a pre-feature one."""
    from edgereco.catalog.publish import CatalogMeta

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
        version="v1",
        embedding_model="m",
        embedding_dim=384,
        embedding_count=1,
        product_count=1,
    )
    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    meta = CatalogMeta.model_validate_json(materialize_file(cache, manifest, "catalog_meta.json"))
    assert meta.schema_version == CURRENT_META_SCHEMA


def test_legacy_catalog_meta_without_schema_version_reads_as_one() -> None:
    """A pre-feature catalog_meta.json (no schema_version) parses as schema 1 — the
    committed bundle stays byte-stable and is treated as legacy."""
    from edgereco.catalog.publish import CatalogMeta

    legacy_json = (
        '{"catalog_id":"x","version":"v1","embedding_model":"m",'
        '"embedding_dim":8,"embedding_count":1,"product_count":1}'
    )
    meta = CatalogMeta.model_validate_json(legacy_json)
    assert meta.schema_version == 1


def test_republish_requires_feature_files_and_raises_when_missing(tmp_path: Path) -> None:
    """Republishing a CURRENT bundle (require_feature_files=True) with a staging dir
    missing ranking_config.json raises — never silently bakes legacy weights in."""
    staging = _staging(tmp_path)  # has no ranking_config.json
    (staging / "cooccurrence.json").write_text(
        CooccurrenceMatrix().model_dump_json(), encoding="utf-8"
    )
    origin = tmp_path / "origin"
    private, _ = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())
    with pytest.raises(FileNotFoundError):
        publish_bundle(
            staging_dir=staging,
            origin_dir=origin,
            private_key_path=key_path,
            catalog_id="amazon-demo",
            version="v2",
            embedding_model="m",
            embedding_dim=384,
            embedding_count=1,
            product_count=1,
            require_feature_files=True,
        )


def test_fresh_build_still_defaults_feature_files(tmp_path: Path) -> None:
    """A genuine fresh build (require_feature_files=False, the default) still gets
    DEFAULT_RANKING_CONFIG + empty cooccurrence written — backward compat preserved."""
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
        version="v1",
        embedding_model="m",
        embedding_dim=384,
        embedding_count=1,
        product_count=1,
    )
    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    raw = materialize_file(cache, manifest, "ranking_config.json")
    assert RankingConfig.model_validate_json(raw) == DEFAULT_RANKING_CONFIG


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
        embedding_count=1,
        product_count=1,
    )

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)
    meta = json.loads(materialize_file(cache, manifest, "catalog_meta.json"))

    assert meta == {
        "catalog_id": "amazon-demo",
        "version": "2026-05-27T00:00:00Z",
        "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
        "embedding_dim": 384,
        "embedding_count": 1,
        "product_count": 1,
        "schema_version": CURRENT_META_SCHEMA,
    }


def test_publish_rejects_symlinked_staging_entry(tmp_path: Path) -> None:
    """A symlink under the staging dir must be REFUSED, never followed: reading it
    would inline an arbitrary host file into the SIGNED bundle (arbitrary-file read).
    """
    staging = _staging(tmp_path)
    secret = tmp_path / "outside_secret.txt"
    secret.write_text("ATTACKER-CONTROLLED SECRET", encoding="utf-8")
    (staging / "vector" / "leak.faiss").symlink_to(secret)

    origin = tmp_path / "origin"
    private, _ = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    with pytest.raises(ValueError, match="symlink"):
        publish_bundle(
            staging_dir=staging,
            origin_dir=origin,
            private_key_path=key_path,
            catalog_id="amazon-demo",
            version="v1",
            embedding_model="m",
            embedding_dim=384,
            embedding_count=1,
            product_count=1,
        )

    # The secret bytes never made it into a signed origin (build never ran).
    assert not origin.exists()


def test_publish_rejects_symlinked_top_level_entry(tmp_path: Path) -> None:
    """A symlinked TOP-LEVEL entry (e.g. ``products.jsonl``) must be REFUSED too, not
    only entries under ``vector/``: ``read_bytes()`` on a fixed-name staged file follows
    the link and inlines an arbitrary host file into the SIGNED bundle (arbitrary read).
    """
    staging = _staging(tmp_path)
    secret = tmp_path / "outside_secret.txt"
    secret.write_text("ATTACKER-CONTROLLED SECRET", encoding="utf-8")
    products = staging / "products.jsonl"
    products.unlink()  # drop the real staged catalog...
    products.symlink_to(secret)  # ...and point its name at a host file outside the tree

    origin = tmp_path / "origin"
    private, _ = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    with pytest.raises(ValueError, match="symlink"):
        publish_bundle(
            staging_dir=staging,
            origin_dir=origin,
            private_key_path=key_path,
            catalog_id="amazon-demo",
            version="v1",
            embedding_model="m",
            embedding_dim=384,
            embedding_count=1,
            product_count=1,
        )

    # The secret bytes never made it into a signed origin (build never ran).
    assert not origin.exists()


def test_bundle_files_contract() -> None:
    assert BUNDLE_FILES == (
        "products.jsonl",
        "vector",
        "catalog_meta.json",
        "ranking_config.json",
        "cooccurrence.json",
    )


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
        embedding_count=1,
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
            "--embedding-count",
            "1",
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
