"""Integration test: retrain_and_republish end-to-end over a local origin.

Builds a tiny signed origin (dummy ``vector/`` — the retrain reuses it verbatim
and never loads FAISS, so no encoder/model is needed), folds in stubbed
engagement, republishes, then re-syncs the republished origin to prove (a) it is
validly signed (fail-closed verifier passes) and (b) the recomputed popularity
round-tripped through the bundle.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from edgeproc.bundles.signing import Ed25519Verifier, generate_keypair

from edgereco.api.deps import sync_and_materialize
from edgereco.catalog.loader import dump_jsonl, load_jsonl
from edgereco.catalog.models import Product
from edgereco.catalog.publish import publish_bundle
from edgereco.reco.retrain import EngagementStat
from edgereco.republish import retrain_and_republish


def _seed_origin(tmp: Path, key_path: Path) -> Path:
    """Publish a tiny signed v1 bundle (dummy vector/) to an origin dir."""
    staging = tmp / "seed-staging"
    (staging / "vector").mkdir(parents=True)
    dump_jsonl(
        staging / "products.jsonl",
        [
            Product(id="P1", title="Alpha", category="Electronics", popularity_score=0.2),
            Product(id="P2", title="Beta", category="Electronics", popularity_score=0.5),
        ],
    )
    (staging / "vector" / "embeddings.f32").write_bytes(b"\x00" * 16)
    (staging / "vector" / "state.json").write_text('{"faiss_ids": ["P1", "P2"]}')
    origin = tmp / "origin"
    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="retrain-test",
        version="v1",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        embedding_count=2,
        product_count=2,
    )
    return origin


@pytest.fixture
def keypair(tmp_path: Path) -> tuple[Path, Ed25519Verifier]:
    private, public = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())
    return key_path, Ed25519Verifier(public)


def test_retrain_republishes_signed_bundle_with_boosted_popularity(
    tmp_path: Path, keypair: tuple[Path, Ed25519Verifier]
) -> None:
    key_path, verifier = keypair
    origin = _seed_origin(tmp_path, key_path)

    result = retrain_and_republish(
        bundle_base_url=str(origin),
        origin_dir=origin,
        private_key_path=key_path,
        verifier=verifier,
        engagement={"P1": EngagementStat(product_id="P1", event_count=5, weighted_score=5.0)},
        alpha=0.5,
        cache_root=tmp_path / "cache",
    )

    # Version bumped, and only the engaged product is reported as changed.
    assert result.version == "v2"
    assert result.product_count == 2
    assert [d.product_id for d in result.changed] == ["P1"]
    assert result.changed[0].before == 0.2
    assert result.changed[0].after == 0.7

    # Re-sync the republished origin: a passing verifier proves it is validly
    # signed (fail-closed intact); the catalog carries the recomputed popularity.
    materialized = sync_and_materialize(
        base_url=str(origin), cache_root=tmp_path / "verify-cache", verifier=verifier
    )
    by_id = {p.id: p for p in load_jsonl(materialized / "products.jsonl")}
    assert by_id["P1"].popularity_score == 0.7
    assert by_id["P2"].popularity_score == 0.5  # untouched
