"""Strategy-aware recommendation orchestration.

``recommend`` resolves a named strategy from the signed ``RankingConfig``, dispatches
its ``candidate_policy`` to choose the candidate pool, then re-ranks with the
strategy's weights. The ``vector_similarity`` policies need a ``seed`` product and
carry a per-candidate cosine into the scorer; the ``co_occurrence`` policy needs a
``seed`` and carries the seed's per-neighbour co-occurrence score. Every other policy
leaves both at 0, so the formula reduces to today's. ``for_you`` with no seed
reproduces the Phase-1 ``select_candidate_pool`` + ``rerank`` path byte-for-byte.

Mirrored in the browser tier's recommend dispatch — keep the policy names, the
strategy/seed contract, and the per-candidate similarity + co-occurrence scores in sync.
"""

from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile
from edgereco.reco.cooccurrence import CooccurrenceMatrix
from edgereco.reco.pool import freshness_pool, popularity_pool, select_candidate_pool
from edgereco.reco.ranking_config import RankingConfig, ScoringWeights, Strategy
from edgereco.reco.scorer import score_product
from edgereco.search.vector import VectorSearcher

_Scores = dict[str, float]


def recommend(
    *,
    catalog: list[Product],
    by_id: dict[str, Product],
    profile: SessionProfile,
    config: RankingConfig,
    vector: VectorSearcher,
    strategy: str,
    seed: str | None,
    limit: int,
    cooccurrence: CooccurrenceMatrix | None = None,
) -> list[SearchResult]:
    """Top-``limit`` results for ``strategy`` (raises ``KeyError`` if unknown)."""
    chosen = config.strategies[strategy]
    candidates, similarity, cooc = _candidates(
        strategy=chosen,
        catalog=catalog,
        by_id=by_id,
        profile=profile,
        vector=vector,
        seed=seed,
        limit=limit,
        cooccurrence=cooccurrence or CooccurrenceMatrix(),
    )
    ranked = _rerank(candidates, profile, chosen.weights, similarity, cooc)
    return ranked[:limit]


def _candidates(
    *,
    strategy: Strategy,
    catalog: list[Product],
    by_id: dict[str, Product],
    profile: SessionProfile,
    vector: VectorSearcher,
    seed: str | None,
    limit: int,
    cooccurrence: CooccurrenceMatrix,
) -> tuple[list[SearchResult], _Scores, _Scores]:
    """Pick the candidate pool for the strategy's policy plus its score maps."""
    policy = strategy.candidate_policy
    if policy == "popularity":
        return popularity_pool(catalog, limit), {}, {}
    if policy == "freshness":
        return freshness_pool(catalog, limit), {}, {}
    if policy == "vector_similarity":
        candidates, similarity = _vector_candidates(by_id, vector, seed, limit)
        return candidates, similarity, {}
    if policy == "co_occurrence":
        candidates, cooc = _cooccurrence_candidates(by_id, cooccurrence, seed, strategy)
        return candidates, {}, cooc
    return select_candidate_pool(catalog, profile, limit, strategy.weights), {}, {}


def _vector_candidates(
    by_id: dict[str, Product],
    vector: VectorSearcher,
    seed: str | None,
    limit: int,
) -> tuple[list[SearchResult], _Scores]:
    """kNN-to-seed candidates plus a per-candidate cosine map (requires a seed)."""
    if seed is None:
        raise ValueError("vector_similarity strategy requires a seed product id")
    hits = vector.nearest(seed, k=limit * 5)
    similarity = {pid: score for pid, score in hits if pid in by_id}
    candidates = [
        SearchResult(product=by_id[pid], score=score) for pid, score in hits if pid in by_id
    ]
    return candidates, similarity


def _cooccurrence_candidates(
    by_id: dict[str, Product],
    cooccurrence: CooccurrenceMatrix,
    seed: str | None,
    strategy: Strategy,
) -> tuple[list[SearchResult], _Scores]:
    """The seed's co-occurrence neighbours as the pool, plus their scores (needs a seed)."""
    if seed is None:
        raise ValueError("co_occurrence strategy requires a seed product id")
    neighbors = cooccurrence.neighbors.get(seed, [])
    if strategy.co_occurrence_top_k is not None:
        neighbors = neighbors[: strategy.co_occurrence_top_k]
    cooc = {n.id: n.score for n in neighbors if n.id in by_id}
    candidates = [
        SearchResult(product=by_id[n.id], score=n.score) for n in neighbors if n.id in by_id
    ]
    return candidates, cooc


def _rerank(
    candidates: list[SearchResult],
    profile: SessionProfile,
    weights: ScoringWeights,
    similarity: _Scores,
    cooccurrence: _Scores,
) -> list[SearchResult]:
    """Score every candidate, threading its seed cosine + co-occurrence score, then sort."""
    rescored = [
        score_product(
            r.product,
            profile,
            weights,
            similarity=similarity.get(r.product.id, 0.0),
            cooccurrence=cooccurrence.get(r.product.id, 0.0),
        )
        for r in candidates
    ]
    rescored.sort(key=lambda r: r.score, reverse=True)
    return rescored
