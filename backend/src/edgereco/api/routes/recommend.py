"""Recommend endpoint: session-aware rerank over full catalog."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from edgereco.api.deps import Container, get_session_id
from edgereco.api.models import RecommendResponse
from edgereco.reco.pool import select_candidate_pool
from edgereco.reco.reranker import rerank

router = APIRouter()


@router.get("/recommend", response_model=RecommendResponse)
def recommend(
    container: Container,
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    session_id: Annotated[str, Depends(get_session_id)] = "",
) -> RecommendResponse:
    profile = container.sessions.get(session_id)
    candidates = select_candidate_pool(container.catalog, profile, limit)
    ranked = rerank(candidates, profile)
    return RecommendResponse(results=ranked[:limit], session_clicks=profile.click_count)
