"""Unit tests for ``ServiceContainer.from_synced`` (signed-chunk bundle consumer).

A tiny REAL FAISS ``vector/`` index is built once from synthetic embeddings (no
model download — ``VectorIndex.build`` takes the embeddings array directly), staged
alongside a ``products.jsonl``, published into a signed origin via B2a's producer,
then consumed by ``from_synced``. The container must expose the same shape
``from_dirs`` returns: catalog, a working vector index, and a ``CatalogManifest``.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
from edgeproc.bundles.adapters import FilesystemAdapter, HttpAdapter
from edgeproc.bundles.signing import Ed25519Verifier, SignatureError, generate_keypair

from edgereco.api.deps import ServiceContainer, _select_adapter
from edgereco.catalog.models import CatalogManifest, Product
from edgereco.catalog.publish import publish_bundle
from edgereco.embeddings.index import VectorIndex

_DIM = 8
_PRODUCTS = [
    Product(id="P1", title="Wireless Headphones", category="Electronics"),
    Product(id="P2", title="Running Shoes", category="Sports"),
    Product(id="P3", title="Cooking Pot", category="Home & Kitchen"),
]


def _build_origin(tmp_path: Path) -> tuple[Path, Ed25519Verifier]:
    """Stage a real tiny index + products, publish a signed origin, return verifier."""
    staging = tmp_path / "staging"
    staging.mkdir()
    rng = np.random.default_rng(0)
    embeddings = rng.standard_normal((len(_PRODUCTS), _DIM)).astype(np.float32)
    index = VectorIndex.build(embeddings, [p.id for p in _PRODUCTS], dim=_DIM)
    index.save(staging / "vector")
    products_jsonl = "\n".join(p.model_dump_json() for p in _PRODUCTS) + "\n"
    (staging / "products.jsonl").write_text(products_jsonl, encoding="utf-8")

    private, public = generate_keypair()
    key_path = tmp_path / "private.key"
    key_path.write_bytes(private.private_bytes_raw())
    origin = tmp_path / "origin"
    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="unit-origin",
        version="2026-05-27T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=_DIM,
        embedding_count=len(_PRODUCTS),
        product_count=len(_PRODUCTS),
    )
    return origin, Ed25519Verifier(public)


def test_from_synced_builds_container(tmp_path: Path) -> None:
    origin, verifier = _build_origin(tmp_path)

    container = ServiceContainer.from_synced(
        base_url=str(origin),
        cache_root=tmp_path / "cache",
        verifier=verifier,
    )

    assert len(container.catalog) == len(_PRODUCTS)
    assert {p.id for p in container.catalog} == {"P1", "P2", "P3"}
    assert container.vector.ntotal == len(_PRODUCTS)
    assert isinstance(container.manifest, CatalogManifest)
    assert container.manifest.catalog_id == "unit-origin"
    assert container.manifest.embedding_dim == _DIM
    # The vector index actually answers a query.
    hits = container.vector.search(np.zeros(_DIM, dtype=np.float32), k=3)
    assert len(hits) == 3


def test_select_adapter_by_scheme(tmp_path: Path) -> None:
    assert isinstance(_select_adapter("https://cdn.example/catalog"), HttpAdapter)
    assert isinstance(_select_adapter("http://cdn.example/catalog"), HttpAdapter)
    assert isinstance(_select_adapter(str(tmp_path)), FilesystemAdapter)


def test_from_synced_fail_closed_on_bad_signature(tmp_path: Path) -> None:
    origin, _ = _build_origin(tmp_path)
    _, wrong_public = generate_keypair()
    with pytest.raises(SignatureError):
        ServiceContainer.from_synced(
            base_url=str(origin),
            cache_root=tmp_path / "cache",
            verifier=Ed25519Verifier(wrong_public),
        )
