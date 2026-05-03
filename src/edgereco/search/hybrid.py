"""Reciprocal Rank Fusion for combining keyword and vector search results."""

from __future__ import annotations


def reciprocal_rank_fusion(
    keyword_results: list[tuple[str, float]],
    vector_results: list[tuple[str, float]],
    *,
    k: int = 60,
) -> list[tuple[str, float]]:
    """rrf_score(doc) = sum(1 / (k + rank_i)) for each list containing doc."""
    rrf_scores: dict[str, float] = {}
    for rank, (doc_id, _score) in enumerate(keyword_results):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    for rank, (doc_id, _score) in enumerate(vector_results):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
