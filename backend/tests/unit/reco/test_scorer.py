from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG, ScoringWeights
from edgereco.reco.scorer import score_product

# The default weights are the source of truth; expected values derive from them,
# not from re-typed magic numbers, so a retune of the config retunes the asserts.
_W = DEFAULT_RANKING_CONFIG.scoring_weights


def _product(**kwargs: object) -> Product:
    defaults: dict[str, object] = {
        "id": "P1",
        "title": "T",
        "category": "Electronics",
        "tags": ["wireless"],
        "brand": "Sony",
        "popularity_score": 0.5,
        "freshness_score": 0.5,
    }
    defaults.update(kwargs)
    return Product(**defaults)  # type: ignore[arg-type]


def test_empty_profile_score() -> None:
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    profile = SessionProfile()
    result = score_product(product, profile, _W)
    expected = _W.popularity * 0.8 + _W.freshness * 0.4
    assert abs(result.score - expected) < 1e-10


def test_category_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(category_affinity={"Electronics": 1.0})
    result = score_product(product, profile, _W)
    assert abs(result.score - _W.category) < 1e-10


def test_tag_match_is_mean() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=["a", "b"], brand="")
    profile = SessionProfile(tag_affinity={"a": 1.0, "b": 0.0})
    result = score_product(product, profile, _W)
    expected = _W.tag * 0.5
    assert abs(result.score - expected) < 1e-10


def test_brand_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="Sony")
    profile = SessionProfile(brand_affinity={"Sony": 1.0})
    result = score_product(product, profile, _W)
    assert abs(result.score - _W.brand) < 1e-10


def test_repetition_penalty() -> None:
    product = _product(id="seen", popularity_score=1.0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(recently_viewed=["seen"])
    result = score_product(product, profile, _W)
    expected = _W.popularity * 1.0 - _W.repetition_penalty
    assert abs(result.score - expected) < 1e-10


def test_repetition_penalty_component_stays_positive_for_ts_parity() -> None:
    """The ``repetition_penalty`` component is stored as the positive penalty
    magnitude (``+0.25``), mirroring the TS browser reranker byte-for-byte. The
    subtraction happens in the ``score``, never in the stored component. Flipping
    this sign would break Python<->TS parity (reranker.test.ts asserts +0.25) and
    the WhyPopover UI, so it is pinned here."""
    product = _product(id="seen", popularity_score=1.0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(recently_viewed=["seen"])
    result = score_product(product, profile, _W)
    assert result.score_components["repetition_penalty"] == _W.repetition_penalty
    assert result.score_components["repetition_penalty"] > 0
    # And the penalty is applied exactly once in the score (not zero, not double).
    expected = _W.popularity * 1.0 - _W.repetition_penalty
    assert abs(result.score - expected) < 1e-12


def test_no_penalty_leaves_score_and_component_untouched() -> None:
    """A product not recently viewed has a zero penalty component and no deduction."""
    product = _product(id="fresh", popularity_score=1.0, freshness_score=0, tags=[], brand="")
    result = score_product(product, SessionProfile(), _W)
    assert result.score_components["repetition_penalty"] == 0.0
    assert abs(result.score - _W.popularity * 1.0) < 1e-12


def test_breakdown_sums_to_score() -> None:
    product = _product(popularity_score=0.7, freshness_score=0.4)
    profile = SessionProfile(
        category_affinity={"Electronics": 0.6},
        tag_affinity={"wireless": 0.8},
        brand_affinity={"Sony": 0.5},
        recently_viewed=["P1"],
    )
    result = score_product(product, profile, _W)
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


def test_default_weights_reproduce_legacy_literal_score() -> None:
    """Pin the absolute legacy numbers once, so a config swap cannot drift them."""
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    result = score_product(product, SessionProfile(), _W)
    assert abs(result.score - (0.40 * 0.8 + 0.10 * 0.4)) < 1e-10


def test_similarity_defaults_to_zero_so_phase1_formula_is_unchanged() -> None:
    """Omitting ``similarity`` leaves the score identical to the Phase-1 formula."""
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    result = score_product(product, SessionProfile(), _W)
    assert result.score_components["similarity"] == 0.0
    assert abs(result.score - (_W.popularity * 0.8 + _W.freshness * 0.4)) < 1e-10


def test_similarity_term_adds_weighted_cosine() -> None:
    """``vector_similarity`` candidates carry a cosine the scorer weights in."""
    product = _product(popularity_score=0.0, freshness_score=0.0, tags=[], brand="")
    sim_weights = ScoringWeights(
        popularity=0.20,
        category=0.05,
        tag=0.04,
        brand=0.03,
        freshness=0.05,
        repetition_penalty=0.25,
        similarity=0.60,
    )
    result = score_product(product, SessionProfile(), sim_weights, similarity=0.5)
    assert abs(result.score_components["similarity"] - 0.60 * 0.5) < 1e-10
    assert abs(result.score - 0.60 * 0.5) < 1e-10


def test_breakdown_with_similarity_sums_to_score() -> None:
    product = _product(popularity_score=0.7, freshness_score=0.4)
    sim_weights = ScoringWeights(
        popularity=0.20,
        category=0.05,
        tag=0.04,
        brand=0.03,
        freshness=0.05,
        repetition_penalty=0.25,
        similarity=0.60,
    )
    result = score_product(product, SessionProfile(), sim_weights, similarity=0.9)
    bd = result.score_components
    summed = (
        bd["popularity"]
        + bd["category_match"]
        + bd["tag_match"]
        + bd["brand_match"]
        + bd["freshness"]
        + bd["similarity"]
        - bd["repetition_penalty"]
    )
    assert abs(result.score - summed) < 1e-10


def test_cooccurrence_defaults_to_zero_so_phase1_formula_is_unchanged() -> None:
    """Omitting ``cooccurrence`` leaves the score identical to the Phase-1 formula."""
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    result = score_product(product, SessionProfile(), _W)
    assert result.score_components["cooccurrence"] == 0.0
    assert abs(result.score - (_W.popularity * 0.8 + _W.freshness * 0.4)) < 1e-10


def test_cooccurrence_term_adds_weighted_neighbour_score() -> None:
    """``co_occurrence`` candidates carry a neighbour score the scorer weights in."""
    product = _product(popularity_score=0.0, freshness_score=0.0, tags=[], brand="")
    cooc_weights = ScoringWeights(
        popularity=0.15,
        category=0.05,
        tag=0.04,
        brand=0.03,
        freshness=0.03,
        repetition_penalty=0.25,
        cooccurrence=0.70,
    )
    result = score_product(product, SessionProfile(), cooc_weights, cooccurrence=0.5)
    assert abs(result.score_components["cooccurrence"] - 0.70 * 0.5) < 1e-10
    assert abs(result.score - 0.70 * 0.5) < 1e-10


def test_breakdown_with_cooccurrence_sums_to_score() -> None:
    product = _product(popularity_score=0.7, freshness_score=0.4)
    cooc_weights = ScoringWeights(
        popularity=0.15,
        category=0.05,
        tag=0.04,
        brand=0.03,
        freshness=0.03,
        repetition_penalty=0.25,
        cooccurrence=0.70,
    )
    result = score_product(product, SessionProfile(), cooc_weights, cooccurrence=0.9)
    bd = result.score_components
    summed = (
        bd["popularity"]
        + bd["category_match"]
        + bd["tag_match"]
        + bd["brand_match"]
        + bd["freshness"]
        + bd["similarity"]
        + bd["cooccurrence"]
        - bd["repetition_penalty"]
    )
    assert abs(result.score - summed) < 1e-10


def test_custom_weights_change_score() -> None:
    """The scorer reads weights from the passed config, not a module constant."""
    product = _product(popularity_score=1.0, freshness_score=0, tags=[], brand="")
    doubled = ScoringWeights(
        popularity=0.80,
        category=0.20,
        tag=0.15,
        brand=0.10,
        freshness=0.10,
        repetition_penalty=0.25,
    )
    result = score_product(product, SessionProfile(), doubled)
    assert abs(result.score - 0.80) < 1e-10
