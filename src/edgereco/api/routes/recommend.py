"""Recommend endpoint: session-aware rerank over full catalog."""
from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Header, Query

from edgereco.api.deps import ServiceContainer, get_container
from edgereco.catalog.models import SearchResult
from edgereco.reco.reranker import rerank

router = APIRouter()


def _session_id(x_session_id: Annotated[str | None, Header()] = None) -> str:
    return x_session_id if x_session_id else str(uuid.uuid4())


@router.get("/recommend")
def recommend(
    limit: Annotated[int, Query(ge=1, le=100)] = 10,
    session_id: Annotated[str, Depends(_session_id)] = "",
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
