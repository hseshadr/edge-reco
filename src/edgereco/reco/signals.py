"""Session signal tracking and profile updates."""
from __future__ import annotations

from edgereco.catalog.models import EventType, Product, SessionProfile

RECENTLY_VIEWED_CAP = 50

INTERACTION_WEIGHTS: dict[EventType, dict[str, float]] = {
    "click":    {"category": 0.10, "tag": 0.05, "brand": 0.08},
    "view":     {"category": 0.02, "tag": 0.01, "brand": 0.02},
    "favorite": {"category": 0.20, "tag": 0.10, "brand": 0.15},
    "cart":     {"category": 0.25, "tag": 0.12, "brand": 0.20},
}


def _bump(current: float, delta: float) -> float:
    return min(1.0, current + delta)


def apply_interaction(
    profile: SessionProfile,
    product: Product,
    event_type: EventType,
) -> SessionProfile:
    weights = INTERACTION_WEIGHTS[event_type]

    cat_aff = dict(profile.category_affinity)
    cat_aff[product.category] = _bump(cat_aff.get(product.category, 0.0), weights["category"])

    tag_aff = dict(profile.tag_affinity)
    for tag in product.tags:
        tag_aff[tag] = _bump(tag_aff.get(tag, 0.0), weights["tag"])

    brand_aff = dict(profile.brand_affinity)
    if product.brand:
        brand_aff[product.brand] = _bump(brand_aff.get(product.brand, 0.0), weights["brand"])

    viewed = [product.id] + [pid for pid in profile.recently_viewed if pid != product.id]
    viewed = viewed[:RECENTLY_VIEWED_CAP]

    return SessionProfile(
        category_affinity=cat_aff,
        tag_affinity=tag_aff,
        brand_affinity=brand_aff,
        recently_viewed=viewed,
        click_count=profile.click_count + (1 if event_type == "click" else 0),
    )
