import numpy as np

from edgereco.embeddings.index import VectorIndex


def test_build_and_search() -> None:
    dim = 8
    embeddings = np.random.default_rng(42).standard_normal((10, dim)).astype(np.float32)
    ids = [f"item_{i}" for i in range(10)]
    index = VectorIndex.build(embeddings, ids, dim=dim)
    query = embeddings[0]
    results = index.search(query, k=3)
    assert len(results) == 3
    assert results[0][0] == "item_0"
    assert results[0][1] >= results[1][1]

def test_search_k_larger_than_index() -> None:
    dim = 4
    embeddings = np.ones((2, dim), dtype=np.float32)
    ids = ["a", "b"]
    index = VectorIndex.build(embeddings, ids, dim=dim)
    results = index.search(np.ones(dim, dtype=np.float32), k=10)
    assert len(results) == 2

def test_save_and_load(tmp_path: object) -> None:
    from pathlib import Path
    save_dir = Path(str(tmp_path))
    dim = 4
    embeddings = np.eye(3, dim, dtype=np.float32)
    ids = ["x", "y", "z"]
    index = VectorIndex.build(embeddings, ids, dim=dim)
    index.save(save_dir)
    loaded = VectorIndex.load(save_dir)
    results = loaded.search(embeddings[1], k=1)
    assert results[0][0] == "y"

def test_empty_index() -> None:
    dim = 4
    embeddings = np.zeros((0, dim), dtype=np.float32)
    index = VectorIndex.build(embeddings, [], dim=dim)
    results = index.search(np.zeros(dim, dtype=np.float32), k=5)
    assert results == []
