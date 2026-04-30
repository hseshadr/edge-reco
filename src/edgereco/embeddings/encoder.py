"""Encode product text into embedding vectors using sentence-transformers."""
from __future__ import annotations

from typing import TYPE_CHECKING, cast

import numpy as np
from numpy.typing import NDArray
from sentence_transformers import SentenceTransformer

if TYPE_CHECKING:
    from edgereco.catalog.models import Product


def _product_text(product: Product) -> str:
    parts = [product.title]
    if product.category:
        parts.append(product.category)
    if product.tags:
        parts.append(" ".join(product.tags))
    if product.brand:
        parts.append(product.brand)
    return " ".join(parts)


class ProductEncoder:
    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        self._model = SentenceTransformer(model_name)

    def encode(self, products: list[Product]) -> NDArray[np.float32]:
        texts = [_product_text(p) for p in products]
        embeddings: NDArray[np.float32] = self._model.encode(
            texts, convert_to_numpy=True, normalize_embeddings=True,
        )
        return embeddings.astype(np.float32)

    def encode_query(self, query: str) -> NDArray[np.float32]:
        embeddings: NDArray[np.float32] = self._model.encode(
            [query], convert_to_numpy=True, normalize_embeddings=True,
        )
        return cast(NDArray[np.float32], embeddings[0].astype(np.float32))

    @property
    def dim(self) -> int:
        return int(self._model.get_embedding_dimension())
