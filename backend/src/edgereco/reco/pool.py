"""Candidate-pool selection for recommend().

Cold (empty profile): popularity top-N — the legacy behavior. Warm (has affinity):
the items matching the session's category/tag/brand affinity, so "Recommended for
you" reflects demonstrated interest. The rerank then orders those matches by the
full formula (popular-within-your-interests first). Popularity backfills only when
there are fewer than `limit` matches, so the rail always fills. The scoring formula
is unchanged; only candidate *selection* changes. Mirrored in poolSelection.ts.
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


def _affinity_matches(catalog: list[Product], profile: SessionProfile) -> list[Product]:
    """Every product the session has shown affinity for (rerank orders them later)."""
    return [p for p in catalog if _affinity_score(p, profile) > 0.0]


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
    """Eligible products for rerank: affinity matches when warm (popularity backfills
    if fewer than `limit`), else popularity top-N."""
    size = min(limit * 5, len(catalog))
    if not _has_affinity(profile):
        pool = _popularity_top(catalog, size)
    else:
        matches = _affinity_matches(catalog, profile)
        if len(matches) >= limit:
            pool = matches
        else:
            pool = _dedup_by_id(matches + _popularity_top(catalog, size))
    return [SearchResult(product=p, score=p.popularity_score) for p in pool]
