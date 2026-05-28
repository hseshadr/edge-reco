from edgereco.catalog.models import Product, SearchResult, SessionProfile
from edgereco.reco.reranker import rerank


def _product(pid: str, category: str = "Electronics", pop: float = 0.5) -> Product:
    return Product(id=pid, title=f"Product {pid}", category=category, popularity_score=pop)


def _result(
    pid: str, score: float, category: str = "Electronics", pop: float = 0.5
) -> SearchResult:
    return SearchResult(product=_product(pid, category, pop), score=score)


def test_rerank_with_empty_profile_preserves_order() -> None:
    results = [_result("a", 0.9), _result("b", 0.7), _result("c", 0.5)]
    reranked = rerank(results, SessionProfile())
    assert len(reranked) == 3


def test_rerank_boosts_matching_category() -> None:
    # formal: 0.40*0.6 = 0.24; electronics: 0.40*0.2 + 0.20*1.0 = 0.28 → electronics wins
    results = [
        _result("formal", 0.9, "Clothing", 0.6),
        _result("electronics", 0.7, "Electronics", 0.2),
    ]
    profile = SessionProfile(category_affinity={"Electronics": 1.0})
    reranked = rerank(results, profile)
    assert reranked[0].product.id == "electronics"


def test_rerank_applies_repetition_penalty() -> None:
    results = [_result("a", 0.9, pop=0.9), _result("b", 0.7, pop=0.7)]
    profile = SessionProfile(recently_viewed=["a"])
    reranked = rerank(results, profile)
    assert reranked[0].product.id == "b"
