from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, GradedSignal
from edgereco.reco.signals import apply_interaction

# The default bundle weights — byte-identical to the historical hardcoded constants.
DEFAULT_WEIGHTS = DEFAULT_RANKING_CONFIG.interaction_weights


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
    assert updated.category_affinity["Electronics"] == DEFAULT_WEIGHTS.click.category


def test_click_bumps_tag_affinity() -> None:
    profile = SessionProfile()
    product = _product(tags=["wireless", "bluetooth"])
    updated = apply_interaction(profile, product, "click")
    assert updated.tag_affinity["wireless"] == DEFAULT_WEIGHTS.click.tag
    assert updated.tag_affinity["bluetooth"] == DEFAULT_WEIGHTS.click.tag


def test_click_bumps_brand_affinity() -> None:
    profile = SessionProfile()
    product = _product(brand="Sony")
    updated = apply_interaction(profile, product, "click")
    assert updated.brand_affinity["Sony"] == DEFAULT_WEIGHTS.click.brand


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


def test_republished_interaction_weights_retune_affinity_bumps() -> None:
    """The republish-retune property: different bundle weights, different bumps."""
    # Given interaction weights retuned to a 5x click category bump
    retuned = DEFAULT_RANKING_CONFIG.interaction_weights.model_copy(
        update={"click": GradedSignal(category=0.50, tag=0.05, brand=0.08)}
    )
    product = _product()
    # When the same click lands under the default vs the retuned weights
    default_profile = apply_interaction(SessionProfile(), product, "click")
    retuned_profile = apply_interaction(SessionProfile(), product, "click", weights=retuned)
    # Then the retuned config changes the affinity outcome — no code change
    assert retuned_profile.category_affinity["Electronics"] == 0.50
    assert (
        default_profile.category_affinity["Electronics"]
        != retuned_profile.category_affinity["Electronics"]
    )
