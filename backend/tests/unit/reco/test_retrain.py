"""Unit tests for the flywheel retrain engine: aggregate + blend.

The retrain engine turns collected interaction events into an updated
``popularity_score`` per product. It is a pure data transform — no formula
change, no I/O — so both tiers (Python core + browser) pick up the new
popularity from the republished bundle with zero code edits.
"""

from edgereco.catalog.models import InteractionEvent, Product
from edgereco.reco.retrain import (
    ENGAGEMENT_WEIGHTS,
    EngagementStat,
    aggregate_engagement,
    blend_popularity,
)


def _event(product_id: str, event_type: str = "click") -> InteractionEvent:
    return InteractionEvent(
        # event_type stays a plain str so callers can pass any kind; the model
        # validates it against the EventType literal at runtime.
        event_type=event_type,  # type: ignore[arg-type]
        product_id=product_id,
        timestamp="2026-06-05T00:00:00Z",
    )


def _product(pid: str, popularity: float = 0.2) -> Product:
    return Product(
        id=pid, title=f"Product {pid}", category="Electronics", popularity_score=popularity
    )


# --- aggregate_engagement -------------------------------------------------


def test_aggregate_empty_returns_empty() -> None:
    assert aggregate_engagement([]) == {}


def test_aggregate_counts_and_weights_per_product() -> None:
    events = [_event("P1", "click"), _event("P1", "click"), _event("P1", "favorite")]
    stats = aggregate_engagement(events)
    assert stats["P1"].event_count == 3
    # 1.0 (click) + 1.0 (click) + 3.0 (favorite)
    assert (
        stats["P1"].weighted_score
        == ENGAGEMENT_WEIGHTS["click"] * 2 + ENGAGEMENT_WEIGHTS["favorite"]
    )


def test_aggregate_separates_distinct_products() -> None:
    stats = aggregate_engagement([_event("P1"), _event("P2")])
    assert set(stats) == {"P1", "P2"}
    assert stats["P1"].event_count == 1
    assert stats["P2"].event_count == 1


def test_engagement_weights_rank_intent() -> None:
    # Higher-intent signals weigh more than a passive view.
    assert (
        ENGAGEMENT_WEIGHTS["cart"] >= ENGAGEMENT_WEIGHTS["favorite"] > ENGAGEMENT_WEIGHTS["click"]
    )
    assert ENGAGEMENT_WEIGHTS["click"] > ENGAGEMENT_WEIGHTS["view"]


# --- blend_popularity -----------------------------------------------------


def test_blend_no_engagement_leaves_products_unchanged() -> None:
    products = [_product("P1", 0.2), _product("P2", 0.5)]
    blended = blend_popularity(products, {}, alpha=0.5)
    assert [p.popularity_score for p in blended] == [0.2, 0.5]


def test_blend_boosts_the_top_engaged_product_by_full_alpha() -> None:
    products = [_product("P1", 0.2)]
    stats = {"P1": EngagementStat(product_id="P1", event_count=1, weighted_score=1.0)}
    blended = blend_popularity(products, stats, alpha=0.5)
    # Sole/top product gets the full alpha boost: 0.2 + 0.5 * (1.0 / 1.0).
    assert blended[0].popularity_score == 0.7


def test_blend_leaves_unengaged_product_unchanged() -> None:
    products = [_product("P1", 0.2), _product("P2", 0.2)]
    stats = {"P1": EngagementStat(product_id="P1", event_count=4, weighted_score=4.0)}
    blended = {p.id: p.popularity_score for p in blend_popularity(products, stats, alpha=0.5)}
    assert blended["P1"] > 0.2
    assert blended["P2"] == 0.2


def test_blend_is_proportional_to_weighted_score() -> None:
    products = [_product("P1", 0.0), _product("P2", 0.0)]
    stats = {
        "P1": EngagementStat(product_id="P1", event_count=4, weighted_score=4.0),
        "P2": EngagementStat(product_id="P2", event_count=1, weighted_score=1.0),
    }
    blended = {p.id: p.popularity_score for p in blend_popularity(products, stats, alpha=0.4)}
    assert blended["P1"] == 0.4  # top: 0 + 0.4 * (4/4)
    assert blended["P2"] == 0.1  # 0 + 0.4 * (1/4)


def test_blend_clamps_popularity_at_one() -> None:
    products = [_product("P1", 0.9)]
    stats = {"P1": EngagementStat(product_id="P1", event_count=9, weighted_score=9.0)}
    blended = blend_popularity(products, stats, alpha=0.5)
    assert blended[0].popularity_score == 1.0


def test_blend_does_not_mutate_input_products() -> None:
    product = _product("P1", 0.2)
    stats = {"P1": EngagementStat(product_id="P1", event_count=1, weighted_score=1.0)}
    blend_popularity([product], stats, alpha=0.5)
    assert product.popularity_score == 0.2
