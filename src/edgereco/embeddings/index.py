"""FAISS-backed vector index for product similarity search."""
from __future__ import annotations

import json
from pathlib import Path

import faiss
import numpy as np
from numpy.typing import NDArray


class VectorIndex:
    def __init__(self, faiss_index: faiss.Index, id_map: list[str]) -> None:
        self._index = faiss_index
        self._id_map = id_map

    @classmethod
    def build(
        cls,
        embeddings: NDArray[np.float32],
        ids: list[str],
        *,
        dim: int,
    ) -> VectorIndex:
        index = faiss.IndexFlatIP(dim)
        if len(embeddings) > 0:
            index.add(embeddings)
        return cls(index, list(ids))

    def search(
        self,
        query: NDArray[np.float32],
        k: int = 10,
    ) -> list[tuple[str, float]]:
        if self._index.ntotal == 0:
            return []
        k = min(k, self._index.ntotal)
        query_2d = query.reshape(1, -1)
        scores, indices = self._index.search(query_2d, k)
        results: list[tuple[str, float]] = []
        for score, idx in zip(scores[0], indices[0], strict=True):
            if idx >= 0:
                results.append((self._id_map[int(idx)], float(score)))
        return results

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        faiss.write_index(self._index, str(directory / "index.faiss"))
        (directory / "id_map.json").write_text(json.dumps(self._id_map))

    @classmethod
    def load(cls, directory: Path) -> VectorIndex:
        index = faiss.read_index(str(directory / "index.faiss"))
        id_map = json.loads((directory / "id_map.json").read_text())
        return cls(index, id_map)
