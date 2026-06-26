"""Strategy-aware ``recommend`` orchestration.

``recommend`` resolves a named strategy from the signed ``RankingConfig``, dispatches
its ``candidate_policy`` to pick the candidate pool, then re-ranks with the strategy's
weights. ``vector_similarity`` strategies need a seed product and carry a per-candidate
cosine into the scorer. ``for_you`` with no seed must reproduce today's behavior.
"""

from __future__ import annotations

import numpy as np
import pytest

from edgereco.catalog.models import Product, SessionProfile
from edgereco.embeddings.index import VectorIndex
from edgereco.reco.cooccurrence import CooccurrenceMatrix, Neighbor
from edgereco.reco.pool import select_candidate_pool
from edgereco.reco.ranking_config import DEFAULT_RANKING_CONFIG
from edgereco.reco.recommend import recommend
from edgereco.reco.reranker import rerank
from edgereco.search.vector import VectorSearcher


def _product(
    pid: str, *, category: str = "Electronics", pop: float = 0.5, fresh: float = 0.5
) -> Product:
    return Product(
        id=pid,
        title=f"Product {pid}",
        category=category,
        popularity_score=pop,
        freshness_score=fresh,
    )


def _catalog() -> list[Product]:
    return [_product(f"p{i}", pop=i / 20, fresh=(20 - i) / 20) for i in range(20)]


def _vector(catalog: list[Product]) -> VectorSearcher:
    dim = 8
    rng = np.random.default_rng(0)
    raw = rng.standard_normal((len(catalog), dim)).astype(np.float32)
    norm = raw / np.linalg.norm(raw, axis=1, keepdims=True)
    index = VectorIndex.build(norm, [p.id for p in catalog], dim=dim)
    return VectorSearcher(index)


def _ids(results: list) -> list[str]:
    return [r.product.id for r in results]


def test_for_you_no_seed_matches_legacy_pool_plus_rerank() -> None:
    catalog = _catalog()
    profile = SessionProfile()
    weights = DEFAULT_RANKING_CONFIG.scoring_weights
    legacy = rerank(select_candidate_pool(catalog, profile, 5, weights), profile, weights)[:5]

    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=profile,
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        strategy="for_you",
        seed=None,
        limit=5,
    )
    assert _ids(got) == _ids(legacy)
    assert [r.score for r in got] == [r.score for r in legacy]


def test_trending_is_popularity_ordered() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        strategy="trending",
        seed=None,
        limit=3,
    )
    # popularity-dominant weights → most-popular first
    assert _ids(got) == ["p19", "p18", "p17"]


def test_new_arrivals_is_freshness_ordered() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        strategy="new_arrivals",
        seed=None,
        limit=3,
    )
    # freshness-dominant weights; p0 is freshest
    assert _ids(got)[0] == "p0"


def test_similar_items_excludes_seed_and_carries_similarity() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        strategy="similar_items",
        seed="p5",
        limit=4,
    )
    assert "p5" not in _ids(got)
    # similarity component is populated for vector strategies
    assert all(r.score_components["similarity"] != 0.0 for r in got)


def test_vector_strategy_without_seed_raises() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    with pytest.raises(ValueError, match="seed"):
        recommend(
            catalog=catalog,
            by_id=by_id,
            profile=SessionProfile(),
            config=DEFAULT_RANKING_CONFIG,
            vector=_vector(catalog),
            strategy="similar_items",
            seed=None,
            limit=4,
        )


def _cooc() -> CooccurrenceMatrix:
    # p5's neighbours, in descending co-occurrence order.
    return CooccurrenceMatrix(
        neighbors={
            "p5": [
                Neighbor(id="p1", score=0.9),
                Neighbor(id="p2", score=0.7),
                Neighbor(id="p3", score=0.5),
                Neighbor(id="p4", score=0.3),
                Neighbor(id="p6", score=0.1),
            ]
        }
    )


def test_also_bought_pool_is_seed_neighbours_ranked_by_cooccurrence() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        cooccurrence=_cooc(),
        strategy="also_bought",
        seed="p5",
        limit=5,
    )
    # candidate pool is exactly the seed's neighbours; seed excluded
    assert set(_ids(got)) == {"p1", "p2", "p3", "p4", "p6"}
    assert "p5" not in _ids(got)
    # cooccurrence-dominant weights → ranked by neighbour score
    assert _ids(got)[0] == "p1"
    assert all(r.score_components["cooccurrence"] != 0.0 for r in got)


def test_also_bought_without_seed_raises() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    with pytest.raises(ValueError, match="seed"):
        recommend(
            catalog=catalog,
            by_id=by_id,
            profile=SessionProfile(),
            config=DEFAULT_RANKING_CONFIG,
            vector=_vector(catalog),
            cooccurrence=_cooc(),
            strategy="also_bought",
            seed=None,
            limit=5,
        )


def test_also_bought_missing_seed_neighbours_yields_empty() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        cooccurrence=CooccurrenceMatrix(),
        strategy="also_bought",
        seed="p5",
        limit=5,
    )
    assert got == []


def test_frequently_bought_together_applies_tighter_cut() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    got = recommend(
        catalog=catalog,
        by_id=by_id,
        profile=SessionProfile(),
        config=DEFAULT_RANKING_CONFIG,
        vector=_vector(catalog),
        cooccurrence=_cooc(),
        strategy="frequently_bought_together",
        seed="p5",
        limit=10,
    )
    # tighter cut keeps only the top neighbours even though 5 exist and limit=10
    assert _ids(got) == ["p1", "p2", "p3"]


def test_unknown_strategy_raises() -> None:
    catalog = _catalog()
    by_id = {p.id: p for p in catalog}
    with pytest.raises(KeyError):
        recommend(
            catalog=catalog,
            by_id=by_id,
            profile=SessionProfile(),
            config=DEFAULT_RANKING_CONFIG,
            vector=_vector(catalog),
            strategy="nonsense",
            seed=None,
            limit=4,
        )
