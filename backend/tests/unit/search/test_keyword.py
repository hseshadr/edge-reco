from edgereco.catalog.models import Product
from edgereco.search.keyword import KeywordSearcher


def _products() -> list[Product]:
    return [
        Product(
            id="1",
            title="Wireless Bluetooth Headphones",
            category="Electronics",
            tags=["wireless", "audio"],
        ),
        Product(
            id="2",
            title="Cotton Running Shorts",
            category="Clothing",
            tags=["cotton", "running"],
        ),
        Product(
            id="3",
            title="Bluetooth Speaker Portable",
            category="Electronics",
            tags=["bluetooth", "speaker"],
        ),
    ]


def test_keyword_search_returns_relevant() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("bluetooth headphones", k=3)
    assert len(results) > 0
    top_ids = [r[0] for r in results]
    assert "1" in top_ids


def test_keyword_search_limit() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("bluetooth", k=1)
    assert len(results) == 1


def test_keyword_search_no_match() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("xyzzy quantum", k=5)
    assert results == []


def test_keyword_search_empty_query() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("", k=5)
    assert results == []
