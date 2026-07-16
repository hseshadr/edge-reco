"""Rerank search results using session profile."""

from __future__ import annotations

from typing import Final

from edgereco.catalog.models import SearchResult, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, ScoringWeights
from edgereco.reco.scorer import score_product

_SEARCH_RELEVANCE_WEIGHT: Final[float] = 0.2


def _retrieval_score(score: float, maximum: float) -> float:
    """Normalize non-negative RRF into the query-relevance component."""
    if maximum <= 0.0:
        return 0.0
    return _SEARCH_RELEVANCE_WEIGHT * max(0.0, score) / maximum


def rerank(
    results: list[SearchResult],
    profile: SessionProfile,
    weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
) -> list[SearchResult]:
    """Personalize an already-selected recommendation candidate pool."""
    return _descending([score_product(r.product, profile, weights) for r in results])


def rerank_search(
    results: list[SearchResult],
    profile: SessionProfile,
    weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
) -> list[SearchResult]:
    """Blend normalized query retrieval with session-aware product signals."""
    maximum = max((result.score for result in results), default=0.0)
    rescored = [
        score_product(
            result.product,
            profile,
            weights,
            retrieval=_retrieval_score(result.score, maximum),
        )
        for result in results
    ]
    return _descending(rescored)


def _descending(results: list[SearchResult]) -> list[SearchResult]:
    results.sort(key=lambda result: result.score, reverse=True)
    return results
