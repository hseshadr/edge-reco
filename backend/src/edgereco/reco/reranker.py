"""Rerank search results using session profile."""

from __future__ import annotations

from edgereco.catalog.models import SearchResult, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, ScoringWeights
from edgereco.reco.scorer import score_product


def rerank(
    results: list[SearchResult],
    profile: SessionProfile,
    weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
) -> list[SearchResult]:
    rescored = [score_product(r.product, profile, weights) for r in results]
    rescored.sort(key=lambda r: r.score, reverse=True)
    return rescored
