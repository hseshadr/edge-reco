"""Step impls for features/session_tracking.feature."""

from __future__ import annotations

from dataclasses import dataclass

import pytest
from pytest_bdd import given, parsers, scenarios, then, when

from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.signals import apply_interaction

scenarios("session_tracking.feature")


@dataclass
class StepContext:
    """Mutable state shared across session-tracking BDD steps."""

    by_id: dict[str, Product] | None = None
    profile: SessionProfile | None = None
    profile_a: SessionProfile | None = None
    profile_b: SessionProfile | None = None


@pytest.fixture
def ctx() -> StepContext:
    return StepContext()


@given("the mini catalog of 50 products is loaded")
def _catalog_loaded(ctx: StepContext, bdd_catalog: list[Product]) -> None:
    ctx.by_id = {p.id: p for p in bdd_catalog}
    assert len(bdd_catalog) == 50


@given("a fresh empty session profile")
def _fresh_profile(ctx: StepContext) -> None:
    ctx.profile = SessionProfile()
    ctx.profile_a = SessionProfile()
    ctx.profile_b = SessionProfile()


@when(parsers.parse('I record a "{event_type}" interaction with product "{product_id}"'))
def _record_event(ctx: StepContext, event_type: str, product_id: str) -> None:
    product = ctx.by_id[product_id]
    ctx.profile = apply_interaction(ctx.profile, product, event_type)


@when(
    parsers.parse('I record a "{event_type}" interaction with product "{product_id}" in profile A')
)
def _record_a(ctx: StepContext, event_type: str, product_id: str) -> None:
    product = ctx.by_id[product_id]
    ctx.profile_a = apply_interaction(ctx.profile_a, product, event_type)


@when(
    parsers.parse('I record a "{event_type}" interaction with product "{product_id}" in profile B')
)
def _record_b(ctx: StepContext, event_type: str, product_id: str) -> None:
    product = ctx.by_id[product_id]
    ctx.profile_b = apply_interaction(ctx.profile_b, product, event_type)


@when(parsers.parse('I record clicks on products "{a}", "{b}", "{c}" in order'))
def _record_three_clicks(ctx: StepContext, a: str, b: str, c: str) -> None:
    by_id: dict[str, Product] = ctx.by_id
    profile = ctx.profile
    for pid in (a, b, c):
        profile = apply_interaction(profile, by_id[pid], "click")
    ctx.profile = profile


@then(
    parsers.parse(
        'the session profile should have a category affinity for "{category}" greater than 0'
    )
)
def _has_cat_affinity(ctx: StepContext, category: str) -> None:
    assert ctx.profile.category_affinity.get(category, 0.0) > 0


@then(parsers.parse('the session profile should have a tag affinity for "{tag}" greater than 0'))
def _has_tag_affinity(ctx: StepContext, tag: str) -> None:
    assert ctx.profile.tag_affinity.get(tag, 0.0) > 0


@then(
    parsers.parse('the session profile should have a brand affinity for "{brand}" greater than 0')
)
def _has_brand_affinity(ctx: StepContext, brand: str) -> None:
    assert ctx.profile.brand_affinity.get(brand, 0.0) > 0


@then(
    parsers.parse(
        "profile B's category affinity for \"{category}\" should be greater than profile A's"
    )
)
def _b_greater_than_a(ctx: StepContext, category: str) -> None:
    a = ctx.profile_a.category_affinity.get(category, 0.0)
    b = ctx.profile_b.category_affinity.get(category, 0.0)
    assert b > a


@then(parsers.parse('the recently-viewed list should start with "{product_id}"'))
def _recently_viewed_starts(ctx: StepContext, product_id: str) -> None:
    assert ctx.profile.recently_viewed[0] == product_id


@then(parsers.parse("the recently-viewed list should contain exactly {n:d} entries"))
def _recently_viewed_n(ctx: StepContext, n: int) -> None:
    assert len(ctx.profile.recently_viewed) == n
