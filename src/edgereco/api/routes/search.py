"""Search endpoint: hybrid BM25 + FAISS + RRF, optional session rerank."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from edgereco.api.deps import Container, get_session_id
from edgereco.catalog.models import SearchResult
from edgereco.reco.reranker import rerank
from edgereco.search.hybrid import reciprocal_rank_fusion

router = APIRouter()


@router.get("/search")
def search(
    container: Container,
    q: Annotated[str, Query()] = "",
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    category: Annotated[str | None, Query()] = None,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> dict[str, Any]:
    if not q.strip():
        return {"results": [], "query": "", "total": 0}

    k = max(limit * 3, 30)
    keyword_hits = container.keyword.search(q, k=k)
    query_vec = container.encoder.encode_query(q)
    vector_hits = container.vector.search(query_vec, k=k)
    fused = reciprocal_rank_fusion(keyword_hits, vector_hits)

    results: list[SearchResult] = []
    for pid, score in fused:
        product = container.by_id.get(pid)
        if product is not None:
            results.append(SearchResult(product=product, score=score))

    total_pre_filter = len(results)

    profile = container.sessions.get(session_id)
    results = rerank(results, profile)

    if category:
        results = [r for r in results if r.product.category == category]

    return {
        "results": [r.model_dump() for r in results[:limit]],
        "query": q,
        "total": total_pre_filter,
    }
