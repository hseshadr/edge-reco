"""Shared fixtures for integration tests."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.loader import load_jsonl

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture(scope="session")
def container() -> ServiceContainer:
    products = load_jsonl(FIXTURES_DIR / "mini_catalog.jsonl")
    return ServiceContainer.from_catalog(products)


@pytest.fixture(scope="session")
def client(container: ServiceContainer) -> TestClient:
    app = create_app(container)
    return TestClient(app)
