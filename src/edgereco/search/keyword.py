"""BM25-based keyword search over products."""

from __future__ import annotations

from typing import TYPE_CHECKING

from rank_bm25 import BM25Okapi

if TYPE_CHECKING:
    from edgereco.catalog.models import Product


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


def _product_tokens(product: Product) -> list[str]:
    parts = [product.title, product.category]
    parts.extend(product.tags)
    if product.brand:
        parts.append(product.brand)
    return _tokenize(" ".join(parts))


class KeywordSearcher:
    def __init__(self, bm25: BM25Okapi, ids: list[str]) -> None:
        self._bm25 = bm25
        self._ids = ids

    @classmethod
    def build(cls, products: list[Product]) -> KeywordSearcher:
        corpus = [_product_tokens(p) for p in products]
        ids = [p.id for p in products]
        bm25 = BM25Okapi(corpus) if corpus else BM25Okapi([[""]])
        return cls(bm25, ids)

    def search(self, query: str, *, k: int = 10) -> list[tuple[str, float]]:
        if not query.strip():
            return []
        tokens = _tokenize(query)
        scores = self._bm25.get_scores(tokens)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        results: list[tuple[str, float]] = []
        for idx, score in ranked[:k]:
            if score > 0:
                results.append((self._ids[idx], float(score)))
        return results
