import numpy as np

from edgereco.embeddings.index import VectorIndex
from edgereco.search.vector import VectorSearcher


def test_vector_search_returns_results() -> None:
    dim = 4
    embeddings = np.eye(3, dim, dtype=np.float32)
    ids = ["a", "b", "c"]
    index = VectorIndex.build(embeddings, ids, dim=dim)
    searcher = VectorSearcher(index)
    results = searcher.search(embeddings[0], k=2)
    assert len(results) == 2
    assert results[0][0] == "a"
