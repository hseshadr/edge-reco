"""Root test fixtures for EdgeReco."""

from __future__ import annotations

from pathlib import Path

import pytest

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product

FIXTURES_DIR = Path(__file__).parent / "fixtures"


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
