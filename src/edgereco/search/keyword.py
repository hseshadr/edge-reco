"""BM25 keyword search over products.

The BM25 engine now comes from EdgeProc (``edge-proc[localvec]``); this module keeps
only the reco-specific projection — how a Product becomes searchable text — and
adapts it to EdgeProc's domain-agnostic ``KeywordSearcher.from_texts``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from edgeproc.localvec.searcher import KeywordSearcher as _EdgeProcKeywordSearcher

if TYPE_CHECKING:
    from edgereco.catalog.models import Product


def _product_tokens(product: Product) -> list[str]:
    parts = [product.title, product.category]
    parts.extend(product.tags)
    if product.brand:
        parts.append(product.brand)
    return " ".join(parts).lower().split()


class KeywordSearcher:
    """Reco adapter over EdgeProc's BM25 searcher."""

    def __init__(self, inner: _EdgeProcKeywordSearcher) -> None:
        self._inner = inner

    @classmethod
    def build(cls, products: list[Product]) -> KeywordSearcher:
        texts = [" ".join(_product_tokens(p)) for p in products]
        ids = [p.id for p in products]
        return cls(_EdgeProcKeywordSearcher.from_texts(texts, ids))

    def search(self, query: str, *, k: int = 10) -> list[tuple[str, float]]:
        return self._inner.search(query, k=k)
