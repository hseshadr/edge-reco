from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.scorer import SCORING_WEIGHTS, score_product  # noqa: F401


def _product(**kwargs: object) -> Product:
    defaults: dict[str, object] = {
        "id": "P1", "title": "T", "category": "Electronics", "tags": ["wireless"],
        "brand": "Sony", "popularity_score": 0.5, "freshness_score": 0.5,
    }
    defaults.update(kwargs)
    return Product(**defaults)  # type: ignore[arg-type]

def test_empty_profile_score() -> None:
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    profile = SessionProfile()
    result = score_product(product, profile)
    expected = 0.40 * 0.8 + 0.10 * 0.4
    assert abs(result.score - expected) < 1e-10

def test_category_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(category_affinity={"Electronics": 1.0})
    result = score_product(product, profile)
    assert abs(result.score - 0.20) < 1e-10

def test_tag_match_is_mean() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=["a", "b"], brand="")
    profile = SessionProfile(tag_affinity={"a": 1.0, "b": 0.0})
    result = score_product(product, profile)
    expected = 0.15 * 0.5
    assert abs(result.score - expected) < 1e-10

def test_brand_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="Sony")
    profile = SessionProfile(brand_affinity={"Sony": 1.0})
    result = score_product(product, profile)
    assert abs(result.score - 0.10) < 1e-10

def test_repetition_penalty() -> None:
    product = _product(id="seen", popularity_score=1.0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(recently_viewed=["seen"])
    result = score_product(product, profile)
    expected = 0.40 * 1.0 - 0.25
    assert abs(result.score - expected) < 1e-10

def test_breakdown_sums_to_score() -> None:
    product = _product(popularity_score=0.7, freshness_score=0.4)
    profile = SessionProfile(
        category_affinity={"Electronics": 0.6},
        tag_affinity={"wireless": 0.8},
        brand_affinity={"Sony": 0.5},
        recently_viewed=["P1"],
    )
    result = score_product(product, profile)
    bd = result.score_components
    summed = (
        bd["popularity"]
        + bd["category_match"]
        + bd["tag_match"]
        + bd["brand_match"]
        + bd["freshness"]
        - bd["repetition_penalty"]
    )
    assert abs(result.score - summed) < 1e-10
