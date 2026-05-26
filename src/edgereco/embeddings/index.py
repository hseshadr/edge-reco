"""Vector index — now backed by EdgeProc's FaissVectorIndex (the shared lego).

edge-reco's historical API is synchronous and returns inner-product *similarity*
(higher = nearer). EdgeProc's ``FaissVectorIndex`` is async and returns cosine
*distance* (lower = nearer). This thin adapter bridges both: it runs the async
calls to completion (every edge-reco call site is synchronous) and converts
distance back to similarity, so behavior is identical to the previous in-house
index while the FAISS work is owned by EdgeProc.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import numpy as np
from edgeproc.localvec.faiss_index import FaissVectorIndex
from numpy.typing import NDArray
from shared_libs_python.vector_mgmt.core.types import IndexConfig, VectorEmbedding

_INDEX_NAME = "edgereco"


class VectorIndex:
    """Synchronous similarity index — a sync facade over EdgeProc's FaissVectorIndex."""

    def __init__(self, inner: FaissVectorIndex) -> None:
        self._inner = inner

    @classmethod
    def build(cls, embeddings: NDArray[np.float32], ids: list[str], *, dim: int) -> VectorIndex:
        inner = FaissVectorIndex(_INDEX_NAME, IndexConfig(dimension=dim))
        items = [
            VectorEmbedding(entity_id=entity_id, embedding=row.tolist())
            for entity_id, row in zip(ids, embeddings, strict=True)
        ]
        asyncio.run(inner.insert(items))
        return cls(inner)

    @property
    def ntotal(self) -> int:
        return asyncio.run(self._inner.get_stats()).vector_count

    def search(self, query: NDArray[np.float32], k: int = 10) -> list[tuple[str, float]]:
        hits = asyncio.run(self._inner.search(query.tolist(), k))
        return [(entity_id, 1.0 - distance) for entity_id, distance in hits]

    def save(self, directory: Path) -> None:
        self._inner.save(directory)

    @classmethod
    def load(cls, directory: Path) -> VectorIndex:
        return cls(FaissVectorIndex.load(_INDEX_NAME, directory))
