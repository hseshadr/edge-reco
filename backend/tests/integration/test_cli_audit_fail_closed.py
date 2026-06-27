"""Regression: ``edgereco audit`` must fail closed exactly like the serving path.

The serving consumer (``ServiceContainer.from_synced``) threads
``meta_schema=meta.schema_version`` into the public ``load_cooccurrence`` /
``load_ranking_config`` loaders so a CURRENT-schema bundle that is missing the file it
should carry raises rather than silently degrading to an empty matrix / the
legacy default weights. ``audit`` previews what a retrain would change and must
honour the same fail-closed contract — a corrupt/tampered current-schema bundle
must make ``audit`` raise, never silently report a diff against defaults.

These tests drive ``_build_audit`` directly with ``sync_and_materialize``
monkeypatched to hand back a materialised local dir whose ``catalog_meta.json``
declares the CURRENT schema but which is missing one of the signed config files.
"""

from __future__ import annotations

from pathlib import Path

import pytest

import edgereco.api.deps as deps
from edgereco.catalog.loader import dump_jsonl
from edgereco.catalog.models import Product
from edgereco.catalog.publish import CURRENT_META_SCHEMA, CatalogMeta
from edgereco.cli import _build_audit
from edgereco.reco.cooccurrence import CooccurrenceMatrix
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG

_PRODUCTS = [
    Product(id="P1", title="A", category="Electronics", popularity_score=0.2),
    Product(id="P2", title="B", category="Electronics", popularity_score=0.5),
]


def _materialize_current_schema_dir(tmp_path: Path) -> Path:
    """A materialised bundle dir declaring the CURRENT schema, both files present."""
    local = tmp_path / "local"
    local.mkdir()
    dump_jsonl(local / "products.jsonl", _PRODUCTS)
    meta = CatalogMeta(
        catalog_id="fail-closed-test",
        version="v1",
        embedding_model="m",
        embedding_dim=8,
        embedding_count=len(_PRODUCTS),
        product_count=len(_PRODUCTS),
        schema_version=CURRENT_META_SCHEMA,
    )
    (local / "catalog_meta.json").write_text(meta.model_dump_json(), encoding="utf-8")
    (local / "cooccurrence.json").write_text(
        CooccurrenceMatrix().model_dump_json(), encoding="utf-8"
    )
    (local / "ranking_config.json").write_text(
        DEFAULT_RANKING_CONFIG.model_dump_json(), encoding="utf-8"
    )
    return local


def _patch_sync(monkeypatch: pytest.MonkeyPatch, local: Path) -> None:
    monkeypatch.setattr(deps, "sync_and_materialize", lambda **_kwargs: local)


def _run_audit(tmp_path: Path) -> None:
    # verify_key_path is read by Ed25519Verifier.from_public_bytes before sync;
    # the synced dir is what we control, so any 32-byte key file is fine here.
    key = tmp_path / "public.key"
    key.write_bytes(b"\x00" * 32)
    _build_audit(
        bundle_base_url="file:///irrelevant",
        verify_key_path=key,
        sessions_path=None,
        alpha=0.5,
        cache_dir=tmp_path / "cache",
    )


def test_audit_fail_closed_when_cooccurrence_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    local = _materialize_current_schema_dir(tmp_path)
    (local / "cooccurrence.json").unlink()
    _patch_sync(monkeypatch, local)

    with pytest.raises(FileNotFoundError):
        _run_audit(tmp_path)


def test_audit_fail_closed_when_ranking_config_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    local = _materialize_current_schema_dir(tmp_path)
    (local / "ranking_config.json").unlink()
    _patch_sync(monkeypatch, local)

    with pytest.raises(FileNotFoundError):
        _run_audit(tmp_path)


def test_public_loaders_are_exposed(tmp_path: Path) -> None:
    # The fail-closed loaders are public module-level contract (cli + audit consume them).
    local = _materialize_current_schema_dir(tmp_path)
    assert deps.load_ranking_config(local, meta_schema=CURRENT_META_SCHEMA) is not None
    assert deps.load_cooccurrence(local, meta_schema=CURRENT_META_SCHEMA) is not None


def test_public_loaders_fail_closed_on_missing_current_schema_file(tmp_path: Path) -> None:
    # A current-schema bundle missing a signed file must raise, never silently degrade.
    empty = tmp_path / "empty"
    empty.mkdir()
    with pytest.raises(FileNotFoundError):
        deps.load_ranking_config(empty, meta_schema=CURRENT_META_SCHEMA)
    with pytest.raises(FileNotFoundError):
        deps.load_cooccurrence(empty, meta_schema=CURRENT_META_SCHEMA)
