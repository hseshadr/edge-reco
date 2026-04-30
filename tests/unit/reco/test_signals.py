from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.signals import INTERACTION_WEIGHTS, apply_interaction


def _product(
    category: str = "Electronics",
    tags: list[str] | None = None,
    brand: str = "Sony",
) -> Product:
    return Product(id="P1", title="Test", category=category, tags=tags or ["wireless"], brand=brand)

def test_click_bumps_category_affinity() -> None:
    profile = SessionProfile()
    product = _product()
    updated = apply_interaction(profile, product, "click")
    assert updated.category_affinity["Electronics"] == INTERACTION_WEIGHTS["click"]["category"]

def test_click_bumps_tag_affinity() -> None:
    profile = SessionProfile()
    product = _product(tags=["wireless", "bluetooth"])
    updated = apply_interaction(profile, product, "click")
    assert updated.tag_affinity["wireless"] == INTERACTION_WEIGHTS["click"]["tag"]
    assert updated.tag_affinity["bluetooth"] == INTERACTION_WEIGHTS["click"]["tag"]

def test_click_bumps_brand_affinity() -> None:
    profile = SessionProfile()
    product = _product(brand="Sony")
    updated = apply_interaction(profile, product, "click")
    assert updated.brand_affinity["Sony"] == INTERACTION_WEIGHTS["click"]["brand"]

def test_favorite_has_higher_bump_than_click() -> None:
    profile = SessionProfile()
    product = _product()
    clicked = apply_interaction(profile, product, "click")
    favorited = apply_interaction(SessionProfile(), product, "favorite")
    assert favorited.category_affinity["Electronics"] > clicked.category_affinity["Electronics"]

def test_affinity_capped_at_1() -> None:
    profile = SessionProfile()
    product = _product()
    for _ in range(20):
        profile = apply_interaction(profile, product, "favorite")
    assert profile.category_affinity["Electronics"] == 1.0

def test_recently_viewed_prepended_and_capped() -> None:
    profile = SessionProfile()
    for i in range(60):
        p = Product(id=f"P{i}", title="T", category="C")
        profile = apply_interaction(profile, p, "click")
    assert len(profile.recently_viewed) == 50
    assert profile.recently_viewed[0] == "P59"

def test_click_count_increments() -> None:
    profile = SessionProfile()
    product = _product()
    profile = apply_interaction(profile, product, "click")
    profile = apply_interaction(profile, product, "click")
    assert profile.click_count == 2
