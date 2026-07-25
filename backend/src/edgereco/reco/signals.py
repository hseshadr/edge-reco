"""Session signal tracking and profile updates.

The per-event affinity bumps come from the signed bundle's
``RankingConfig.interaction_weights`` (``reco.ranking_config``), threaded in by the
caller — retune by republishing data, no code change. The default reproduces the
historical hardcoded weights byte-for-byte and mirrors the browser tier's
``applyInteraction`` (``engine/session.ts``), which reads the same field at runtime.
"""

from __future__ import annotations

from collections.abc import Iterable

from edgereco.catalog.models import EventType, Product, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, InteractionWeights

RECENTLY_VIEWED_CAP = 50


def _bump(current: float, delta: float) -> float:
    return min(1.0, current + delta)


def _bump_all(affinity: dict[str, float], keys: Iterable[str], delta: float) -> dict[str, float]:
    """Copy ``affinity`` with every key in ``keys`` bumped by ``delta`` (capped at 1.0)."""
    bumped = dict(affinity)
    for key in keys:
        bumped[key] = _bump(bumped.get(key, 0.0), delta)
    return bumped


def _recently_viewed(profile: SessionProfile, product_id: str) -> list[str]:
    """``product_id`` moved to the front, deduplicated, capped at ``RECENTLY_VIEWED_CAP``."""
    viewed = [product_id] + [pid for pid in profile.recently_viewed if pid != product_id]
    return viewed[:RECENTLY_VIEWED_CAP]


def apply_interaction(
    profile: SessionProfile,
    product: Product,
    event_type: EventType,
    weights: InteractionWeights = DEFAULT_RANKING_CONFIG.interaction_weights,
) -> SessionProfile:
    graded = weights.for_event(event_type)
    cat_aff = _bump_all(profile.category_affinity, [product.category], graded.category)
    tag_aff = _bump_all(profile.tag_affinity, product.tags, graded.tag)
    brand_keys = [product.brand] if product.brand else []
    brand_aff = _bump_all(profile.brand_affinity, brand_keys, graded.brand)
    return SessionProfile(
        category_affinity=cat_aff,
        tag_affinity=tag_aff,
        brand_affinity=brand_aff,
        recently_viewed=_recently_viewed(profile, product.id),
        click_count=profile.click_count + (1 if event_type == "click" else 0),
    )
