"""Recommend endpoint: session-aware rerank over full catalog."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from edgereco.api.deps import Container, get_session_id
from edgereco.catalog.models import SearchResult
from edgereco.reco.reranker import rerank

router = APIRouter()


@router.get("/recommend")
def recommend(
    container: Container,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> dict[str, Any]:
    profile = container.sessions.get(session_id)
    pool_size = min(limit * 5, len(container.catalog))
    pool = sorted(container.catalog, key=lambda p: p.popularity_score, reverse=True)[
        :pool_size
    ]
    candidates = [SearchResult(product=p, score=p.popularity_score) for p in pool]
    ranked = rerank(candidates, profile)
    return {
        "results": [r.model_dump() for r in ranked[:limit]],
        "session_clicks": profile.click_count,
    }
