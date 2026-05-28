"""Shared BDD fixtures for EdgeReco acceptance tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture(scope="session")
def bdd_catalog() -> list[Product]:
    return load_jsonl(FIXTURES_DIR / "mini_catalog.jsonl")


@pytest.fixture(scope="session")
def bdd_encoder() -> ProductEncoder:
    return ProductEncoder()


@pytest.fixture(scope="session")
def bdd_keyword_searcher(bdd_catalog: list[Product]) -> KeywordSearcher:
    return KeywordSearcher.build(bdd_catalog)


@pytest.fixture(scope="session")
def bdd_vector_index(bdd_catalog: list[Product], bdd_encoder: ProductEncoder) -> VectorIndex:
    embeddings = bdd_encoder.encode(bdd_catalog)
    ids = [p.id for p in bdd_catalog]
    return VectorIndex.build(embeddings, ids, dim=bdd_encoder.dim)


@pytest.fixture(scope="session")
def bdd_vector_searcher(bdd_vector_index: VectorIndex) -> VectorSearcher:
    return VectorSearcher(bdd_vector_index)
