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
from typing import Final

import numpy as np
from edgeproc.localvec.faiss_index import FaissVectorIndex
from numpy.typing import NDArray
from shared_libs_python.vector_mgmt.core.types import IndexConfig, VectorEmbedding

_INDEX_NAME = "edgereco"

#: Raw, L2-normalized ``float32`` matrix (``ntotal x dim``, row-major) written next
#: to ``index.faiss``/``state.json`` so a Python-faiss-less tier (the browser) can do
#: cosine search directly. Row ``i`` ↔ ``state.json`` ``faiss_ids[i]`` ↔ product id.
EMBEDDINGS_FILE: Final[str] = "embeddings.f32"


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

    def raw_matrix(self) -> NDArray[np.float32]:
        """Reconstruct the stored vectors as a contiguous ``ntotal x dim`` float32
        matrix in id-map order: row ``i`` is the vector for ``faiss_ids[i]``.

        The inputs are L2-normalized at encode time and ``IndexFlatIP`` stores them
        verbatim, so the reconstruction is the same normalized matrix the browser
        does cosine search over.
        """
        faiss_index = self._inner._faiss  # sync facade owns the inner index
        ntotal = int(faiss_index.ntotal)
        if ntotal == 0:
            return np.empty((0, self._inner.config.dimension), dtype=np.float32)
        matrix = faiss_index.reconstruct_n(0, ntotal)
        return np.ascontiguousarray(matrix, dtype=np.float32)

    def save(self, directory: Path) -> None:
        self._inner.save(directory)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / EMBEDDINGS_FILE).write_bytes(self.raw_matrix().tobytes())

    @classmethod
    def load(cls, directory: Path) -> VectorIndex:
        return cls(FaissVectorIndex.load(_INDEX_NAME, directory))
