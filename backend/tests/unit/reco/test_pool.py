"""Candidate-pool selection for recommend().

The pool defines which products are eligible for reranking. Cold (empty profile)
it is popularity-only — unchanged legacy behavior. Warm it is the union of the
popularity top-N and an affinity top-M, so low-popularity items matching the
session's taste become candidates and can surface in the rail.
"""

from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.pool import select_candidate_pool


def _product(
    pid: str, category: str = "Electronics", pop: float = 0.5, tags: list[str] | None = None
) -> Product:
    return Product(
        id=pid, title=f"Product {pid}", category=category, popularity_score=pop, tags=tags or []
    )


def _ids(results: list) -> list[str]:
    return [r.product.id for r in results]


def test_empty_profile_returns_popularity_top_n() -> None:
    catalog = [_product(f"p{i}", pop=i / 10) for i in range(10)]
    pool = select_candidate_pool(catalog, SessionProfile(), limit=2)
    # n = min(limit*5, len) = min(10, 10) = 10 → whole catalog, popularity-ordered
    assert _ids(pool) == [f"p{i}" for i in range(9, -1, -1)]


def test_empty_profile_caps_pool_at_limit_times_five() -> None:
    catalog = [_product(f"p{i}", pop=i / 100) for i in range(100)]
    pool = select_candidate_pool(catalog, SessionProfile(), limit=2)
    assert len(pool) == 10  # min(2*5, 100)


def test_warm_profile_includes_affinity_item_outside_popularity_pool() -> None:
    # 50 popular Electronics + 1 unpopular Clothing item the user clicked into affinity.
    catalog = [_product(f"e{i}", category="Electronics", pop=0.9) for i in range(50)]
    niche = _product("niche", category="Clothing", pop=0.01)
    catalog.append(niche)
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    # popularity-only pool (top 10) would never include the unpopular niche item;
    # the affinity pool must surface it as a candidate.
    assert "niche" in _ids(pool)


def test_warm_profile_still_includes_popularity_top_n() -> None:
    catalog = [_product(f"e{i}", category="Electronics", pop=(i + 1) / 100) for i in range(50)]
    catalog.append(_product("niche", category="Clothing", pop=0.01))
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    assert "e49" in _ids(pool)  # the single most popular item is always a candidate


def test_pool_is_deduped_by_id() -> None:
    # An item that is both popular AND matches affinity must appear once.
    catalog = [_product("top", category="Clothing", pop=1.0)]
    catalog += [_product(f"e{i}", category="Electronics", pop=0.5) for i in range(5)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    assert _ids(pool).count("top") == 1


def test_pool_size_bounded_by_popularity_n_plus_affinity_m() -> None:
    catalog = [_product(f"p{i}", category="Clothing", pop=i / 100) for i in range(100)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    # n = m = min(2*5, 100) = 10; with full overlap the union is bounded by n + m.
    assert len(pool) <= 20


def test_affinity_pool_excludes_zero_affinity_items() -> None:
    # No product matches the profile's affinity → warm pool collapses to popularity-only.
    catalog = [_product(f"e{i}", category="Electronics", pop=i / 10) for i in range(10)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    assert _ids(pool) == [f"e{i}" for i in range(9, -1, -1)]
