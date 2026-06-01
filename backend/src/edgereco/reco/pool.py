"""Candidate-pool selection for recommend().

Cold (empty profile): popularity top-N — the legacy behavior. Warm: the union of
popularity top-N and an affinity top-M, deduped by id, so low-popularity items
matching the session's taste become candidates and can surface after rerank.
The scoring formula is unchanged; only candidate *selection* broadens. Mirrored
in @edgeproc/browser's poolSelection.ts.
"""

from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile
from edgereco.reco.scorer import SCORING_WEIGHTS


def _affinity_score(product: Product, profile: SessionProfile) -> float:
    """Personalization-only score (category + tag + brand affinity), no popularity."""
    cat = profile.category_affinity.get(product.category, 0.0)
    tag = 0.0
    if product.tags:
        tag = sum(profile.tag_affinity.get(t, 0.0) for t in product.tags) / len(product.tags)
    brand = profile.brand_affinity.get(product.brand, 0.0) if product.brand else 0.0
    w = SCORING_WEIGHTS
    return w["category"] * cat + w["tag"] * tag + w["brand"] * brand


def _has_affinity(profile: SessionProfile) -> bool:
    """True once the session has folded in any interaction signal."""
    return bool(profile.category_affinity or profile.tag_affinity or profile.brand_affinity)


def _popularity_top(catalog: list[Product], n: int) -> list[Product]:
    return sorted(catalog, key=lambda p: p.popularity_score, reverse=True)[:n]


def _affinity_top(catalog: list[Product], profile: SessionProfile, m: int) -> list[Product]:
    scored = [(p, _affinity_score(p, profile)) for p in catalog]
    matching = [(p, s) for p, s in scored if s > 0.0]
    matching.sort(key=lambda ps: ps[1], reverse=True)
    return [p for p, _ in matching[:m]]


def _dedup_by_id(products: list[Product]) -> list[Product]:
    seen: set[str] = set()
    unique: list[Product] = []
    for product in products:
        if product.id not in seen:
            seen.add(product.id)
            unique.append(product)
    return unique


def select_candidate_pool(
    catalog: list[Product], profile: SessionProfile, limit: int
) -> list[SearchResult]:
    """Eligible products for rerank: popularity top-N, plus affinity top-M when warm."""
    size = min(limit * 5, len(catalog))
    pool = _popularity_top(catalog, size)
    if _has_affinity(profile):
        pool = _dedup_by_id(pool + _affinity_top(catalog, profile, size))
    return [SearchResult(product=p, score=p.popularity_score) for p in pool]
