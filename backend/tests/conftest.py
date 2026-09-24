"""Root test fixtures for EdgeReco."""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product

FIXTURES_DIR = Path(__file__).parent / "fixtures"

# The suite is a build machine: its encoder tests embed with the real
# sentence-transformers weights, and edge-proc >=0.4.0 refuses to fetch a model unless
# told it may. Opt in here, explicitly and only for the test run; a configured
# EDGEPROC_MODEL_PATH still takes precedence and loads offline. The refusal itself is
# pinned by tests/unit/embeddings/test_encoder_model_source.py, which clears this.
os.environ.setdefault("EDGEPROC_ALLOW_MODEL_DOWNLOAD", "1")


@pytest.fixture
def fixtures_dir() -> Path:
    """Path to the test fixtures directory."""
    return FIXTURES_DIR


@pytest.fixture
def mini_catalog() -> list[Product]:
    """Load the 50-product mini catalog fixture."""
    return load_jsonl(FIXTURES_DIR / "mini_catalog.jsonl")


@pytest.fixture
def electronics_products(mini_catalog: list[Product]) -> list[Product]:
    """Filter mini catalog to Electronics products only."""
    return [p for p in mini_catalog if p.category == "Electronics"]
