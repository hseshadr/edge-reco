"""Flywheel retrain engine: turn interaction events into updated popularity.

The uplink half captures clicks and ships them to the cloud collector; this is
the recompute half. ``aggregate_engagement`` folds a batch of events into a
weighted score per product; ``blend_popularity`` boosts each product's static
``popularity_score`` by its (max-normalized) engagement.

This is a pure DATA transform — it changes ``popularity_score`` values only, not
the scoring formula. Both tiers (``reco/scorer.py`` and the browser reranker)
read ``popularity_score`` straight off the synced product, so the republished
bundle re-ranks on both with zero code edits.
"""

from __future__ import annotations

from pydantic import BaseModel

from edgereco.catalog.models import EventType, InteractionEvent, Product
from edgereco.catalog.preprocessor import normalize_score

# Per-event-type weight toward GLOBAL popularity (distinct from
# ``reco.signals.INTERACTION_WEIGHTS``, which drives per-session affinity).
# Higher-intent signals (cart, favorite) count for more than a passive view.
ENGAGEMENT_WEIGHTS: dict[EventType, float] = {
    "click": 1.0,
    "view": 0.2,
    "favorite": 3.0,
    "cart": 4.0,
}


class EngagementStat(BaseModel):
    """Aggregated engagement for one product across a batch of events."""

    product_id: str
    event_count: int
    weighted_score: float


def aggregate_engagement(events: list[InteractionEvent]) -> dict[str, EngagementStat]:
    """Fold events into a weighted engagement score per ``product_id``."""
    stats: dict[str, EngagementStat] = {}
    for event in events:
        prev = stats.get(event.product_id)
        stats[event.product_id] = EngagementStat(
            product_id=event.product_id,
            event_count=(prev.event_count if prev else 0) + 1,
            weighted_score=(prev.weighted_score if prev else 0.0)
            + ENGAGEMENT_WEIGHTS[event.event_type],
        )
    return stats


def blend_popularity(
    products: list[Product],
    engagement: dict[str, EngagementStat],
    *,
    alpha: float,
) -> list[Product]:
    """Boost each product's popularity by ``alpha`` * its max-normalized engagement.

    Un-engaged products are returned unchanged; the most-engaged product gets the
    full ``alpha`` boost. Inputs are never mutated (``model_copy``).
    """
    max_weighted = max((stat.weighted_score for stat in engagement.values()), default=0.0)
    return [
        _boosted(product, engagement.get(product.id), alpha, max_weighted) for product in products
    ]


def _boosted(
    product: Product,
    stat: EngagementStat | None,
    alpha: float,
    max_weighted: float,
) -> Product:
    """Return a copy of ``product`` with engagement folded into popularity."""
    if stat is None:
        return product
    norm = normalize_score(stat.weighted_score, min_val=0.0, max_val=max_weighted)
    new_popularity = min(1.0, product.popularity_score + alpha * norm)
    return product.model_copy(update={"popularity_score": new_popularity})
