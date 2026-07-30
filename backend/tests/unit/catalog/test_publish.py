"""Unit tests for the bundle PRODUCER (edge-proc ``build_bundle`` wrapper).

A tiny synthetic staging dir stands in for a real built catalog (no model
download): a small ``products.jsonl`` plus a ``vector/`` dir of dummy bytes. The
producer is content-agnostic, so dummy FAISS artifacts exercise the full path.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from assay.receipt import ScoreReceipt
from avow import content_hash, verify_signature
from edgeproc.bundles.adapters import FilesystemAdapter
from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.manifest import IndexManifest, VersionPointer
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
from edgereco.reco.score_receipt import RANKING_RECEIPT_NAME

runner = CliRunner()

_PRODUCTS = '{"id":"P1","title":"Widget","category":"Electronics"}\n'
#: What the producer signs: every product's ``image_url`` points at its local card.
_LOCALIZED_PRODUCTS = (
    '{"id":"P1","title":"Widget","category":"Electronics","image_url":"/images/P1.svg"}\n'
)
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

    pointer = VersionPointer.model_validate_json((origin / "latest").read_bytes())
    assert pointer.bundle_id == "amazon-demo"
    assert pointer.channel == "stable"
    assert pointer.sequence == 1

    cache = FilesystemCacheStore(tmp_path / "cache")
    sync_index(
        base_url=str(origin),
        store=cache,
        adapter=FilesystemAdapter(),
        verifier=Ed25519Verifier(public),
    )
    manifest = _active_manifest(cache)

    assert materialize_file(cache, manifest, "products.jsonl") == _LOCALIZED_PRODUCTS.encode(
        "utf-8"
    )
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
        "ranking_receipt.json",
        "cooccurrence.json",
        # The producer bakes one card per product and signs it alongside the catalog.
        "images/P1.svg",
    } == {entry.path for entry in manifest.files}
    assert meta["catalog_id"] == "amazon-demo"


def test_publish_localizes_remote_product_image_urls(tmp_path: Path) -> None:
    """A catalog whose products carry REMOTE CDN image urls must publish as a bundle
    whose ``image_url`` values are root-relative and whose cards ship inside the
    signature.

    This is the PROPERTY the storefront depends on, not the shape of a staging dir.
    ``ProductImage`` renders an ``<img>`` only for a root-relative, same-origin url
    (``isLocalImage``), and production ships ``img-src 'self' data:`` — so a bundle
    that keeps ``https://m.media-amazon.com/...`` renders NO product image at all
    AND would leak every visitor's IP to a third party if it did. Localizing only in
    the demo rebuild script left every other publisher on the broken path.
    """
    staging = _staging(tmp_path)
    (staging / "products.jsonl").write_text(
        '{"id":"P1","title":"Widget","category":"Electronics",'
        '"image_url":"https://m.media-amazon.com/images/I/71abc.jpg"}\n',
        encoding="utf-8",
    )
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
    record = json.loads(materialize_file(cache, manifest, "products.jsonl").decode("utf-8"))

    assert record["image_url"] == "/images/P1.svg", (
        "publish must localize remote image urls; the storefront renders no <img> "
        "for an off-origin url and production CSP (img-src 'self') would block it"
    )
    # The card the rewritten url points at must actually be in the signed bundle.
    assert "images/P1.svg" in {entry.path for entry in manifest.files}
    assert materialize_file(cache, manifest, "images/P1.svg").startswith(b"<svg")


def test_republishing_the_same_staging_dir_is_byte_identical(tmp_path: Path) -> None:
    """Publishing twice from ONE staging dir must produce the SAME manifest hash.

    This is the invariant the whole change rests on: the producer now rewrites
    products.jsonl and re-renders cards on EVERY publish, so if either step were not
    idempotent every republish would move the bundle hash and the committed demo
    bundle could never be reproduced. Pinning it here means a future renderer change
    that smuggles in a timestamp, a random id, or a lossy line split trips a test
    instead of silently churning every consumer's sync.
    """
    staging = _staging(tmp_path)
    (staging / "products.jsonl").write_text(
        '{"id":"P1","title":"Widget","category":"Electronics",'
        '"image_url":"https://m.media-amazon.com/images/I/71abc.jpg"}\n',
        encoding="utf-8",
    )
    private, _ = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())

    def publish_to(origin: Path) -> str:
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
        pointer = VersionPointer.model_validate_json((origin / "latest").read_bytes())
        return pointer.manifest_hash

    # The second publish reads back exactly what the first one wrote.
    assert publish_to(tmp_path / "origin-a") == publish_to(tmp_path / "origin-b")


def test_localize_survives_unicode_line_separators(tmp_path: Path) -> None:
    """A product carrying U+2028 / U+2029 / U+0085 must round-trip a publish.

    ``json.dumps(ensure_ascii=False)`` emits all three RAW, and ``str.splitlines()``
    treats every one as a line terminator — so splitting the catalog that way writes a
    products.jsonl the producer cannot re-read, and which the browser consumer (which
    splits on ``\\n``) would parse into different records than the producer intended.
    """
    staging = _staging(tmp_path)
    # Written as escapes on purpose: a raw U+2028/U+2029/U+0085 in source is
    # invisible and easily mangled by an editor, which would silently defang this.
    title = "Wid\u2028get\u2029 Pro\u0085X"
    (staging / "products.jsonl").write_text(
        json.dumps({"id": "P1", "title": title, "category": "Electronics"}, ensure_ascii=False)
        + "\n",
        encoding="utf-8",
    )
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
    raw = materialize_file(cache, manifest, "products.jsonl").decode("utf-8")

    # Exactly ONE record survives, title intact, splitting the way the browser does.
    records = [line for line in raw.split("\n") if line.strip()]
    assert len(records) == 1
    assert json.loads(records[0])["title"] == title


def test_publish_refuses_symlinked_images_dir(tmp_path: Path) -> None:
    """A symlink planted at the ``images/`` DIR must be refused before any card write.

    ``O_NOFOLLOW`` only guards the FINAL path component, and ``mkdir(exist_ok=True)``
    accepts a symlink that already resolves to a directory — so without an explicit
    check on the dir itself, ``images -> /elsewhere`` turns the producer's per-product
    card writes into an arbitrary-file WRITE primitive.
    """
    staging = _staging(tmp_path)
    victim = tmp_path / "victim_dir"
    victim.mkdir()
    (staging / "images").symlink_to(victim, target_is_directory=True)

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

    # Nothing was written through the link, and no signed origin was built.
    assert list(victim.iterdir()) == []
    assert not origin.exists()


def test_bundle_covers_staged_product_images(tmp_path: Path) -> None:
    """Staged ``images/*.svg`` are read into the bundle, listed in the manifest, and
    reassemble verbatim after sync — i.e. they are inside the ed25519 signature.

    Uses an id the catalog does NOT contain: cards for catalog products are owned and
    regenerated by the producer (see ``test_publish_localizes_remote_product_image_urls``),
    while any other staged image is still carried verbatim inside the signature.
    """
    staging = _staging(tmp_path)
    (staging / "images").mkdir()
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
    (staging / "images" / "EXTRA1.svg").write_bytes(svg)
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
    assert "images/EXTRA1.svg" in {entry.path for entry in manifest.files}
    assert materialize_file(cache, manifest, "images/EXTRA1.svg") == svg


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


def test_bundle_carries_verifiable_ranking_receipt(tmp_path: Path) -> None:
    """Every publish seals the STAGED weights as a signed ranking attestation
    (``ranking_receipt.json``) an offline verifier can check under the SAME
    publisher key that signs the bundle — one pinned identity for both."""
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
    raw = materialize_file(cache, manifest, RANKING_RECEIPT_NAME)
    receipt = ScoreReceipt.model_validate_json(raw)
    verify_signature(receipt, expected_public_key=public.public_bytes_raw().hex())
    governed = content_hash(tuned.scoring_weights.model_dump(mode="json"))
    assert receipt.payload.metric_version == governed


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


def test_publish_refuses_symlinked_meta_write_target(tmp_path: Path) -> None:
    """A symlink pre-planted at the ``catalog_meta.json`` WRITE path must be REFUSED,
    never followed: the producer ALWAYS (re)writes ``catalog_meta.json``, and a plain
    ``write_text`` follows a symlink there and clobbers whatever it targets — an
    arbitrary host-file WRITE-through. Fail closed before the target is touched.
    """
    staging = _staging(tmp_path)  # products.jsonl + vector/, no catalog_meta.json yet
    secret = tmp_path / "outside_secret.txt"
    original = "ATTACKER-VICTIM FILE — MUST NOT BE OVERWRITTEN"
    secret.write_text(original, encoding="utf-8")
    (staging / "catalog_meta.json").symlink_to(secret)  # hostile symlink at write path

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

    # The producer's write was refused: the victim target keeps its original bytes.
    assert secret.read_text(encoding="utf-8") == original
    # And no signed origin was built.
    assert not origin.exists()


def test_bundle_files_contract() -> None:
    assert BUNDLE_FILES == (
        "products.jsonl",
        "vector",
        "catalog_meta.json",
        "ranking_config.json",
        "ranking_receipt.json",
        "cooccurrence.json",
        "images",
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
