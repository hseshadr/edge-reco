"""Pure-function catalog logic. Zero HTTP/FastAPI/Pydantic imports."""

from __future__ import annotations

import json
from collections.abc import Sequence
from pathlib import Path

from .types import DomainCandidateContext, DomainItem


def load_catalog(path: Path | str) -> list[DomainItem]:
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    return [
        DomainItem(
            id=str(entry["id"]),
            title=str(entry["title"]),
            category=str(entry["category"]),
            tags=tuple(str(t) for t in entry["tags"]),
            popularity_score=float(entry["popularityScore"]),
            freshness_score=float(entry["freshnessScore"]),
        )
        for entry in raw
    ]


def filter_candidates(
    catalog: Sequence[DomainItem],
    context: DomainCandidateContext,
) -> list[DomainItem]:
    filtered: list[DomainItem] = [
        item
        for item in catalog
        if context.category_hint is None or item.category == context.category_hint
    ]
    filtered.sort(key=lambda item: item.popularity_score, reverse=True)
    return filtered[: context.limit]
