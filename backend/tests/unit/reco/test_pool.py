"""Candidate-pool selection for recommend().

The pool defines which products are eligible for reranking:

* Cold (empty profile): popularity top-N — unchanged legacy behavior.
* Warm (has affinity): items matching the session's category/tag/brand affinity.
  When there are at least `limit` matches the rail is drawn purely from them, so
  "Recommended for you" reflects demonstrated interest (the rerank then orders
  them, popular-within-your-interests first). Popularity backfills only when there
  are too few matches to fill the rail.
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


def _categories(results: list) -> set[str]:
    return {r.product.category for r in results}


def test_empty_profile_returns_popularity_top_n() -> None:
    catalog = [_product(f"p{i}", pop=i / 10) for i in range(10)]
    pool = select_candidate_pool(catalog, SessionProfile(), limit=2)
    # n = min(limit*5, len) = min(10, 10) = 10 → whole catalog, popularity-ordered
    assert _ids(pool) == [f"p{i}" for i in range(9, -1, -1)]


def test_empty_profile_caps_pool_at_limit_times_five() -> None:
    catalog = [_product(f"p{i}", pop=i / 100) for i in range(100)]
    pool = select_candidate_pool(catalog, SessionProfile(), limit=2)
    assert len(pool) == 10  # min(2*5, 100)


def test_warm_pool_is_drawn_from_affinity_matches_when_enough() -> None:
    # 50 popular Electronics + 20 less-popular Clothing the user has shown interest in.
    catalog = [_product(f"e{i}", category="Electronics", pop=0.9) for i in range(50)]
    catalog += [_product(f"c{i}", category="Clothing", pop=0.5) for i in range(20)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    # >= limit Clothing matches → rail is drawn purely from them; popular Electronics excluded.
    assert _categories(pool) == {"Clothing"}
    assert "e0" not in _ids(pool)


def test_warm_pool_surfaces_unpopular_affinity_item() -> None:
    catalog = [_product(f"e{i}", category="Electronics", pop=0.9) for i in range(50)]
    catalog += [_product(f"c{i}", category="Clothing", pop=0.01) for i in range(5)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    # Clothing items are deep in the popularity tail but are candidates because they match.
    assert "c0" in _ids(pool)


def test_warm_pool_backfills_popularity_when_too_few_matches() -> None:
    # Only one matching item — fewer than `limit`, so popularity backfills the rail.
    catalog = [_product(f"e{i}", category="Electronics", pop=(i + 1) / 100) for i in range(50)]
    catalog.append(_product("niche", category="Clothing", pop=0.01))
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=5)
    ids = _ids(pool)
    assert "niche" in ids  # the lone match is a candidate
    assert "e49" in ids  # ...and popularity backfills so the rail can still fill


def test_no_affinity_matches_collapses_to_popularity() -> None:
    # Profile has affinity, but nothing in the catalog matches → popularity-only.
    catalog = [_product(f"e{i}", category="Electronics", pop=i / 10) for i in range(10)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=2)
    assert _ids(pool) == [f"e{i}" for i in range(9, -1, -1)]


def test_pool_is_deduped_by_id() -> None:
    # A match that is also the popularity leader (backfill path) must appear once.
    catalog = [_product("top", category="Clothing", pop=1.0)]
    catalog += [_product(f"e{i}", category="Electronics", pop=0.5) for i in range(5)]
    profile = SessionProfile(category_affinity={"Clothing": 1.0})
    pool = select_candidate_pool(catalog, profile, limit=5)
    assert _ids(pool).count("top") == 1
