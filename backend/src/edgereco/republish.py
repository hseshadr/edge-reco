"""Retrain republish job: recompute popularity from events, re-sign, republish.

This is the cloud side of the flywheel — the counterpart to the in-tab uplink.
It syncs the current signed bundle, folds collected engagement into
``popularity_score`` (``reco.retrain``), re-stages the catalog (reusing the
prebuilt FAISS ``vector/`` verbatim — embeddings depend on text, not popularity),
and republishes a freshly signed bundle with a bumped version. Both tiers pick
up the new popularity on their next sync, with zero scoring-formula changes.
"""

from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import Final

import httpx
from edgeproc.bundles.cas import FilesystemCacheStore
from edgeproc.bundles.signing import Verifier
from pydantic import BaseModel

from edgereco.api.deps import sync_and_materialize
from edgereco.api.models import EngagementExport
from edgereco.catalog.loader import dump_jsonl, load_jsonl
from edgereco.catalog.models import Product
from edgereco.catalog.publish import CatalogMeta, publish_bundle
from edgereco.reco.cooccurrence import Session, build_cooccurrence
from edgereco.reco.retrain import EngagementStat, blend_popularity

_TRAILING_INT = re.compile(r"^(.*?)(\d+)$")
# Collector is a sibling cloud service; a retrain that can't reach it should fail
# fast and loud, not hang the maintainer's terminal.
_FETCH_TIMEOUT_S: Final[float] = 30.0


class PopularityDelta(BaseModel):
    """A product whose ``popularity_score`` changed during a retrain."""

    product_id: str
    before: float
    after: float


class RetrainResult(BaseModel):
    """Outcome of a retrain: the new version and which products moved."""

    version: str
    product_count: int
    changed: list[PopularityDelta]


def bump_version(current: str) -> str:
    """Return the next bundle version: increment a trailing integer, else suffix.

    ``v1`` -> ``v2``; ``v1.2`` -> ``v1.3``; ISO timestamps (end in ``Z``) get a
    ``-r2`` suffix since they carry no trailing integer to bump.
    """
    match = _TRAILING_INT.match(current)
    if match is None:
        return f"{current}-r2"
    return f"{match.group(1)}{int(match.group(2)) + 1}"


def fetch_engagement(events_url: str) -> dict[str, EngagementStat]:
    """Pull aggregated engagement from a collector's ``/events/export`` endpoint."""
    response = httpx.get(events_url, timeout=_FETCH_TIMEOUT_S)
    response.raise_for_status()
    export = EngagementExport.model_validate_json(response.content)
    return {stat.product_id: stat for stat in export.stats}


def retrain_and_republish(
    *,
    bundle_base_url: str,
    origin_dir: Path,
    private_key_path: Path,
    verifier: Verifier,
    engagement: dict[str, EngagementStat],
    alpha: float,
    cache_root: Path,
    version: str | None = None,
    sessions: list[Session] | None = None,
) -> RetrainResult:
    """Sync the current bundle, fold in engagement + co-occurrence, and republish.

    Popularity is recomputed from ``engagement``; the co-occurrence matrix is
    recomputed from ``sessions`` (empty ⇒ an empty matrix). Both are pure DATA
    transforms — the scoring formula never changes. The prebuilt FAISS ``vector/``
    is reused verbatim (embeddings depend on text, not engagement), so no re-encode
    is needed. Fails closed on a bad signature.
    """
    materialized = sync_and_materialize(
        base_url=bundle_base_url, cache_root=cache_root, verifier=verifier
    )
    active = FilesystemCacheStore(cache_root).read_active()
    if active is None:  # pragma: no cover - sync_and_materialize promoted or raised
        raise RuntimeError("sync completed without an active bundle pointer")
    next_sequence = 1 if active.sequence is None else active.sequence + 1
    base = load_jsonl(materialized / "products.jsonl")
    meta = CatalogMeta.model_validate_json((materialized / "catalog_meta.json").read_bytes())
    blended = blend_popularity(base, engagement, alpha=alpha)
    new_version = version or bump_version(meta.version)
    staging = _stage_catalog(materialized, blended, cache_root / "staging", sessions or [])
    _publish(
        staging=staging,
        origin_dir=origin_dir,
        private_key_path=private_key_path,
        meta=meta,
        version=new_version,
        product_count=len(blended),
        sequence=next_sequence,
    )
    return RetrainResult(
        version=new_version, product_count=len(blended), changed=_deltas(base, blended)
    )


def _stage_catalog(
    materialized: Path, products: list[Product], staging: Path, sessions: list[Session]
) -> Path:
    """Write the recomputed catalog + co-occurrence; reuse the prebuilt ``vector/``.

    The synced bundle's ``ranking_config.json`` is carried over VERBATIM so a retrain
    only moves data (popularity + co-occurrence) and never silently reverts tuned
    weights to the default. A retrain only changes popularity values, not the formula.
    """
    staging.mkdir(parents=True, exist_ok=True)
    dump_jsonl(staging / "products.jsonl", products)
    matrix = build_cooccurrence(sessions)
    (staging / "cooccurrence.json").write_text(matrix.model_dump_json(), encoding="utf-8")
    shutil.copy2(materialized / "ranking_config.json", staging / "ranking_config.json")
    shutil.copytree(materialized / "vector", staging / "vector", dirs_exist_ok=True)
    return staging


def _publish(
    *,
    staging: Path,
    origin_dir: Path,
    private_key_path: Path,
    meta: CatalogMeta,
    version: str,
    product_count: int,
    sequence: int,
) -> None:
    """Sign and lay out the republished origin (new manifest + ``latest``).

    ``require_feature_files=True``: this republishes a CURRENT bundle, so the staged
    ``ranking_config.json`` (carried over by ``_stage_catalog``) + ``cooccurrence.json``
    must be present — a missing file raises rather than silently baking in defaults.
    """
    publish_bundle(
        staging_dir=staging,
        origin_dir=origin_dir,
        private_key_path=private_key_path,
        catalog_id=meta.catalog_id,
        version=version,
        embedding_model=meta.embedding_model,
        embedding_dim=meta.embedding_dim,
        embedding_count=meta.embedding_count,
        product_count=product_count,
        require_feature_files=True,
        sequence=sequence,
    )


def _deltas(before: list[Product], after: list[Product]) -> list[PopularityDelta]:
    """Products whose popularity changed, highest new score first."""
    base = {product.id: product.popularity_score for product in before}
    changed = [
        PopularityDelta(product_id=p.id, before=base[p.id], after=p.popularity_score)
        for p in after
        if p.popularity_score != base[p.id]
    ]
    return sorted(changed, key=lambda delta: delta.after, reverse=True)
