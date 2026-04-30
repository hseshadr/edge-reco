"""Recommend endpoint: session-aware rerank over full catalog."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from edgereco.api.deps import ServiceContainer, get_container, get_session_id
from edgereco.catalog.models import SearchResult
from edgereco.reco.reranker import rerank

router = APIRouter()


@router.get("/recommend")
def recommend(
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    session_id: Annotated[str, Depends(get_session_id)] = "",
    container: Annotated[ServiceContainer, Depends(get_container)] = ...,  # type: ignore[assignment]
) -> dict[str, Any]:
    profile = container.sessions.get(session_id)
    candidates = [
        SearchResult(product=p, score=p.popularity_score) for p in container.catalog
    ]
    ranked = rerank(candidates, profile)
    return {
        "results": [r.model_dump() for r in ranked[:limit]],
        "session_clicks": profile.click_count,
    }
