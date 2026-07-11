"""Encode product text into embedding vectors.

The sentence-transformers engine now comes from EdgeProc (``edge-proc[localvec]``);
this module keeps only the reco-specific projection — how a Product becomes text —
and delegates encoding to EdgeProc's domain-agnostic ``TextEncoder``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from edgeproc.localvec.encoder import TextEncoder

if TYPE_CHECKING:
    import numpy as np
    from numpy.typing import NDArray

    from edgereco.catalog.models import Product

#: The embedding model reco defaults to when a bundle declares none of its own.
#: Public so consumers can bind (and log) it as an EXPLICIT decision rather than a
#: silent hardcoded fallback (see ``edgereco.api.deps._bind_encoder``).
DEFAULT_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"


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
    """Reco adapter over EdgeProc's TextEncoder."""

    def __init__(self, model_name: str = DEFAULT_MODEL_NAME) -> None:
        self._encoder = TextEncoder(model_name)

    def encode(self, products: list[Product]) -> NDArray[np.float32]:
        return self._encoder.encode_texts([_product_text(p) for p in products])

    def encode_query(self, query: str) -> NDArray[np.float32]:
        return self._encoder.encode_query(query)

    @property
    def dim(self) -> int:
        return self._encoder.dim
