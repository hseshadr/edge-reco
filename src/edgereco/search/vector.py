"""Vector similarity search using FAISS index."""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from edgereco.embeddings.index import VectorIndex


class VectorSearcher:
    def __init__(self, index: VectorIndex) -> None:
        self._index = index

    @property
    def ntotal(self) -> int:
        return self._index.ntotal

    def search(
        self,
        query_embedding: NDArray[np.float32],
        *,
        k: int = 10,
    ) -> list[tuple[str, float]]:
        return self._index.search(query_embedding, k=k)
