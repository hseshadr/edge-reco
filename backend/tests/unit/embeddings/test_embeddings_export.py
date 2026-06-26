"""Unit tests for the raw embedding matrix export (``vector/embeddings.f32``).

The browser tier can't load Python-faiss, so the bundle must carry the raw,
L2-normalized ``float32`` matrix and do cosine search over it directly. These
tests pin the on-disk contract:

- byte length ``== ntotal * dim * 4``, dtype float32, each row L2-norm ≈ 1.0;
- row ``i`` of the matrix ↔ ``state.json`` ``faiss_ids[i]`` ↔ product id;
- numpy cosine top-k over the matrix returns the SAME top ids as FAISS search
  (the equivalence C2b's TS search must match).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from edgereco.embeddings.index import EMBEDDINGS_FILE, VectorIndex


def _normalized(rng: np.random.Generator, rows: int, dim: int) -> NDArray[np.float32]:
    raw = rng.standard_normal((rows, dim)).astype(np.float32)
    norms = np.linalg.norm(raw, axis=1, keepdims=True)
    return (raw / norms).astype(np.float32)


def test_writes_embeddings_f32_with_expected_bytes(tmp_path: Path) -> None:
    dim, rows = 16, 12
    embeddings = _normalized(np.random.default_rng(7), rows, dim)
    ids = [f"item_{i}" for i in range(rows)]

    index = VectorIndex.build(embeddings, ids, dim=dim)
    index.save(tmp_path)

    raw = (tmp_path / EMBEDDINGS_FILE).read_bytes()
    assert len(raw) == rows * dim * 4

    matrix = np.frombuffer(raw, dtype=np.float32).reshape(rows, dim)
    assert matrix.dtype == np.float32
    norms = np.linalg.norm(matrix, axis=1)
    np.testing.assert_allclose(norms, np.ones(rows), atol=1e-5)


def test_matrix_row_order_matches_faiss_id_map(tmp_path: Path) -> None:
    dim, rows = 16, 12
    embeddings = _normalized(np.random.default_rng(11), rows, dim)
    ids = [f"item_{i}" for i in range(rows)]

    index = VectorIndex.build(embeddings, ids, dim=dim)
    index.save(tmp_path)

    state = json.loads((tmp_path / "state.json").read_text())
    faiss_ids: list[str] = state["faiss_ids"]
    assert faiss_ids == ids  # insertion order preserved

    matrix = np.frombuffer((tmp_path / EMBEDDINGS_FILE).read_bytes(), dtype=np.float32).reshape(
        rows, dim
    )
    # row i cosine-self ≈ 1, and cosine top-1 of row i against the matrix is i.
    sims = matrix @ matrix.T
    for i in range(rows):
        assert sims[i, i] == max(sims[i])
        assert int(np.argmax(sims[i])) == i


def test_empty_index_writes_zero_byte_matrix(tmp_path: Path) -> None:
    dim = 8
    index = VectorIndex.build(np.zeros((0, dim), dtype=np.float32), [], dim=dim)
    index.save(tmp_path)
    assert (tmp_path / EMBEDDINGS_FILE).read_bytes() == b""


def test_numpy_cosine_topk_matches_faiss(tmp_path: Path) -> None:
    """The raw-matrix cosine path is equivalent to FAISS search (C2b contract)."""
    dim, rows = 24, 40
    embeddings = _normalized(np.random.default_rng(99), rows, dim)
    ids = [f"item_{i}" for i in range(rows)]

    index = VectorIndex.build(embeddings, ids, dim=dim)
    index.save(tmp_path)

    matrix = np.frombuffer((tmp_path / EMBEDDINGS_FILE).read_bytes(), dtype=np.float32).reshape(
        rows, dim
    )
    faiss_ids = json.loads((tmp_path / "state.json").read_text())["faiss_ids"]

    query = _normalized(np.random.default_rng(123), 1, dim)[0]
    k = 10

    # FAISS path (via the index facade).
    faiss_top = [pid for pid, _ in index.search(query, k=k)]

    # numpy raw-matrix cosine path (what the browser does).
    sims = matrix @ query
    numpy_order = np.argsort(-sims)[:k]
    numpy_top = [faiss_ids[i] for i in numpy_order]

    assert numpy_top == faiss_top
