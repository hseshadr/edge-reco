"""Search endpoint: hybrid BM25 + FAISS + RRF, optional session rerank."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from edgereco.api.deps import Container, ServiceContainer, get_session_id
from edgereco.api.models import SearchResponse
from edgereco.catalog.models import SearchResult
from edgereco.reco.reranker import rerank_search
from edgereco.search.hybrid import reciprocal_rank_fusion

router = APIRouter()


def _fused_results(container: ServiceContainer, q: str, k: int) -> list[SearchResult]:
    """Hybrid keyword + vector hits fused with RRF, hydrated against the catalog."""
    keyword_hits = container.keyword.search(q, k=k)
    query_vec = container.encoder.encode_query(q)
    vector_hits = container.vector.search(query_vec, k=k)
    results: list[SearchResult] = []
    for pid, score in reciprocal_rank_fusion(keyword_hits, vector_hits):
        product = container.by_id.get(pid)
        if product is not None:
            results.append(SearchResult(product=product, score=score))
    return results


def _filter_category(results: list[SearchResult], category: str | None) -> list[SearchResult]:
    """Keep only ``category`` products when a category filter is given."""
    if not category:
        return results
    return [r for r in results if r.product.category == category]


@router.get("/search", response_model=SearchResponse)
def search(
    container: Container,
    q: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    category: Annotated[str | None, Query()] = None,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> SearchResponse:
    if not q.strip():
        return SearchResponse(results=[], query="", total=0)

    results = _fused_results(container, q, k=max(limit * 3, 30))
    total_pre_filter = len(results)

    profile = container.sessions.get(session_id)
    ranked = rerank_search(results, profile, container.ranking_config.scoring_weights)
    results = _filter_category(ranked, category)

    return SearchResponse(results=results[:limit], query=q, total=total_pre_filter)
