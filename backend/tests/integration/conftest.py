"""Shared fixtures for integration tests.

The ``container`` is built the way the edge runtime really builds it: publish a
signed, content-addressed bundle from the mini catalog, then ``from_synced`` it.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest
from edgeproc.bundles.signing import Ed25519Verifier, generate_keypair
from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.publish import publish_bundle
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture(scope="session")
def container(tmp_path_factory: pytest.TempPathFactory) -> ServiceContainer:
    staging = tmp_path_factory.mktemp("staging")
    shutil.copy2(FIXTURES_DIR / "mini_catalog.jsonl", staging / "products.jsonl")
    products = load_jsonl(staging / "products.jsonl")
    encoder = ProductEncoder()
    index = VectorIndex.build(encoder.encode(products), [p.id for p in products], dim=encoder.dim)
    index.save(staging / "vector")

    private, public = generate_keypair()
    key_path = tmp_path_factory.mktemp("keys") / "private.key"
    key_path.write_bytes(private.private_bytes_raw())
    origin = tmp_path_factory.mktemp("origin")
    publish_bundle(
        staging_dir=staging,
        origin_dir=origin,
        private_key_path=key_path,
        catalog_id="integration-origin",
        version="v1",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=encoder.dim,
        embedding_count=len(products),
        product_count=len(products),
    )
    return ServiceContainer.from_synced(
        base_url=str(origin),
        cache_root=tmp_path_factory.mktemp("cache"),
        verifier=Ed25519Verifier(public),
    )


@pytest.fixture(scope="session")
def client(container: ServiceContainer) -> TestClient:
    app = create_app(container)
    return TestClient(app)
