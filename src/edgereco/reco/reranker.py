"""Rerank search results using session profile."""
from __future__ import annotations

from edgereco.catalog.models import SearchResult, SessionProfile
from edgereco.reco.scorer import score_product


def rerank(
    results: list[SearchResult],
    profile: SessionProfile,
) -> list[SearchResult]:
    rescored = [score_product(r.product, profile) for r in results]
    rescored.sort(key=lambda r: r.score, reverse=True)
    return rescored
