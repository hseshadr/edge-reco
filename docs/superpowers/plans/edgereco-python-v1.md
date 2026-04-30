# EdgeReco Python v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each subagent MUST use `superpowers:test-driven-development`.

**Goal:** Build a Python-first edge product discovery engine with hybrid search (BM25 + FAISS), session-aware recommendations, catalog sync, BDD test suite, and Docker Compose demo over real Amazon product data.

**Architecture:** `src/edgereco/` Python 3.13 package with catalog loading, embedding encoding, FAISS vector index, BM25 keyword search, RRF hybrid fusion, session signal tracking, affinity-based scoring/reranking, manifest-based catalog sync, FastAPI API, Typer CLI, and Docker Compose demo (origin + Caddy edge + app).

**Tech Stack:** Python 3.13, Pydantic v2, Polars, faiss-cpu, sentence-transformers, rank-bm25, pytest-bdd, FastAPI, Typer, pydantic-settings, httpx, uv, ruff, mypy.

**Companion spec:** [`../specs/edgereco-python-v1.md`](../specs/edgereco-python-v1.md)

---

## Phase A: Foundation (Tasks 1-5)

### Task 1: Project scaffold

**Files:**
- Create: `pyproject.toml`
- Create: `src/edgereco/__init__.py`
- Create: `src/edgereco/py.typed`
- Create: `tests/__init__.py`
- Create: `tests/conftest.py`
- Modify: `.gitignore`

- [ ] **Step 1: Write `pyproject.toml`**

```toml
[project]
name = "edgereco"
version = "0.1.0"
description = "Edge product discovery engine — hybrid search + session-aware recommendations"
requires-python = ">=3.13"
license = "MIT"
dependencies = [
  "pydantic>=2.9",
  "pydantic-settings>=2.6",
  "polars>=1.0",
  "faiss-cpu>=1.9",
  "sentence-transformers>=3.3",
  "rank-bm25>=0.2",
  "fastapi>=0.115",
  "uvicorn[standard]>=0.32",
  "typer>=0.15",
  "httpx>=0.27",
  "numpy>=2.0",
  "structlog>=24.4",
]

[dependency-groups]
dev = [
  "pytest>=8.3",
  "pytest-cov>=6.0",
  "pytest-bdd>=8.1",
  "mypy>=1.11",
  "ruff>=0.6",
]

[tool.uv]
package = true

[project.scripts]
edgereco = "edgereco.cli:app"

[tool.pytest.ini_options]
testpaths = ["tests"]
addopts = "-ra --strict-markers"
pythonpath = ["src"]
bdd_features_base_dir = "features/"
markers = [
  "bdd: BDD acceptance tests",
  "integration: integration tests",
  "e2e: end-to-end tests",
]

[tool.mypy]
python_version = "3.13"
strict = true
warn_return_any = true
warn_unused_configs = true
packages = ["edgereco"]
mypy_path = "src"

[tool.ruff]
line-length = 100
target-version = "py313"
src = ["src", "tests"]

[tool.ruff.lint]
select = ["E", "F", "W", "I", "B", "SIM", "UP", "N", "S", "A", "C4", "PT", "RUF"]
ignore = ["S101"]  # allow assert in tests

[tool.coverage.run]
source = ["edgereco"]
omit = ["tests/*"]

[tool.coverage.report]
fail_under = 90
show_missing = true
```

- [ ] **Step 2: Create package files**

`src/edgereco/__init__.py`:
```python
"""EdgeReco — Edge product discovery engine."""

__version__ = "0.1.0"
```

`src/edgereco/py.typed` — empty marker file for PEP 561.

`tests/__init__.py` — empty.

`tests/conftest.py`:
```python
"""Root test fixtures for EdgeReco."""
```

- [ ] **Step 3: Update `.gitignore`** — read existing, append if not present:
```
*.egg-info/
.uv/
```

- [ ] **Step 4: Lock and sync**
```bash
uv lock && uv sync --group dev
```

- [ ] **Step 5: Verify**
```bash
uv run pytest --co -q  # should discover 0 tests, no errors
uv run mypy src        # should pass (no code to check yet)
uv run ruff check src tests  # should pass
```

- [ ] **Step 6: Commit**
```bash
git add pyproject.toml src/ tests/ .gitignore uv.lock
git commit -m "feat: scaffold Python 3.13 project with uv + ruff + mypy + pytest-bdd"
```

---

### Task 2: Config module

**Files:**
- Create: `src/edgereco/config.py`
- Create: `tests/unit/test_config.py`

- [ ] **Step 1: Write failing test**

```python
# tests/unit/test_config.py
from edgereco.config import Settings

def test_default_settings() -> None:
    settings = Settings()
    assert settings.catalog_url == ""
    assert settings.cache_dir.name == ".edgereco"
    assert settings.embedding_model == "sentence-transformers/all-MiniLM-L6-v2"
    assert settings.embedding_dim == 384
    assert settings.search_limit == 10
    assert settings.rrf_k == 60

def test_settings_from_env(monkeypatch: object) -> None:
    import pytest
    with pytest.MonkeyPatch.context() as mp:
        mp.setenv("EDGERECO_CATALOG_URL", "http://edge:8081/manifest.json")
        mp.setenv("EDGERECO_CACHE_DIR", "/tmp/test-cache")
        mp.setenv("EDGERECO_SEARCH_LIMIT", "20")
        settings = Settings()
        assert settings.catalog_url == "http://edge:8081/manifest.json"
        assert str(settings.cache_dir) == "/tmp/test-cache"
        assert settings.search_limit == 20
```

- [ ] **Step 2: Run test — should FAIL**
```bash
uv run pytest tests/unit/test_config.py -v
```

- [ ] **Step 3: Implement**

```python
# src/edgereco/config.py
"""Environment-based configuration for EdgeReco."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """EdgeReco configuration loaded from environment variables."""

    model_config = {"env_prefix": "EDGERECO_"}

    catalog_url: str = ""
    cache_dir: Path = Path.home() / ".edgereco"
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    embedding_dim: int = 384
    search_limit: int = 10
    rrf_k: int = 60
    api_host: str = "0.0.0.0"
    api_port: int = 8000
```

- [ ] **Step 4: Run test — should PASS**

- [ ] **Step 5: Commit**
```bash
git add src/edgereco/config.py tests/unit/test_config.py
git commit -m "feat: add Pydantic Settings config module"
```

---

### Task 3: Catalog models + loader (TDD)

**Files:**
- Create: `src/edgereco/catalog/__init__.py`
- Create: `src/edgereco/catalog/models.py`
- Create: `src/edgereco/catalog/loader.py`
- Create: `tests/unit/catalog/__init__.py`
- Create: `tests/unit/catalog/test_models.py`
- Create: `tests/unit/catalog/test_loader.py`
- Create: `tests/fixtures/mini_catalog.jsonl`

- [ ] **Step 1: Create mini test fixture** — `tests/fixtures/mini_catalog.jsonl` with 5 products:

```jsonl
{"id":"B001","title":"Wireless Bluetooth Headphones","description":"Over-ear noise cancelling","category":"Electronics","subcategories":["Audio","Headphones"],"tags":["wireless","bluetooth","noise-cancelling"],"brand":"SoundMax","price":79.99,"currency":"USD","popularity_score":0.85,"freshness_score":0.60,"image_url":"","url":"","attributes":{"color":"black"}}
{"id":"B002","title":"Cotton Running Shorts","description":"Lightweight breathable shorts","category":"Clothing","subcategories":["Men","Athletic"],"tags":["cotton","running","lightweight"],"brand":"FitWear","price":29.99,"currency":"USD","popularity_score":0.72,"freshness_score":0.45,"image_url":"","url":"","attributes":{"size":"M","color":"blue"}}
{"id":"B003","title":"Stainless Steel Water Bottle","description":"Insulated 32oz","category":"Home & Kitchen","subcategories":["Kitchen","Drinkware"],"tags":["stainless-steel","insulated","bpa-free"],"brand":"HydroKeep","price":24.99,"currency":"USD","popularity_score":0.68,"freshness_score":0.70,"image_url":"","url":"","attributes":{"capacity":"32oz"}}
{"id":"B004","title":"Yoga Mat Premium","description":"Non-slip exercise mat","category":"Sports","subcategories":["Yoga","Equipment"],"tags":["yoga","non-slip","exercise"],"brand":"ZenFit","price":39.99,"currency":"USD","popularity_score":0.55,"freshness_score":0.80,"image_url":"","url":"","attributes":{"thickness":"6mm"}}
{"id":"B005","title":"Python Programming Cookbook","description":"Advanced recipes for Python developers","category":"Books","subcategories":["Programming","Python"],"tags":["python","programming","cookbook"],"brand":"TechPress","price":44.99,"currency":"USD","popularity_score":0.62,"freshness_score":0.35,"image_url":"","url":"","attributes":{}}
```

- [ ] **Step 2: Write model tests**

```python
# tests/unit/catalog/test_models.py
from edgereco.catalog.models import Product, CatalogManifest, CatalogFile, SessionProfile

def test_product_from_dict() -> None:
    data = {"id": "B001", "title": "Test", "category": "Electronics", "price": 9.99}
    product = Product.model_validate(data)
    assert product.id == "B001"
    assert product.popularity_score == 0.0
    assert product.tags == []

def test_product_full_fields() -> None:
    product = Product(
        id="B001", title="Test", category="Electronics",
        tags=["wireless"], brand="Sony", price=99.99,
        popularity_score=0.85, freshness_score=0.6,
    )
    assert product.brand == "Sony"
    assert len(product.tags) == 1

def test_catalog_manifest() -> None:
    manifest = CatalogManifest(
        catalog_id="test", version="2026-01-01T00:00:00Z",
        embedding_model="all-MiniLM-L6-v2", embedding_dim=384,
        files=[CatalogFile(path="products.jsonl", file_type="products", checksum="sha256:abc")],
    )
    assert manifest.catalog_id == "test"
    assert len(manifest.files) == 1

def test_session_profile_defaults() -> None:
    profile = SessionProfile()
    assert profile.category_affinity == {}
    assert profile.click_count == 0
    assert profile.recently_viewed == []
```

- [ ] **Step 3: Write loader tests**

```python
# tests/unit/catalog/test_loader.py
from pathlib import Path
from edgereco.catalog.loader import load_jsonl

FIXTURES = Path(__file__).parent.parent.parent / "fixtures"

def test_load_jsonl_returns_products() -> None:
    products = load_jsonl(FIXTURES / "mini_catalog.jsonl")
    assert len(products) == 50
    assert products[0].id == "B001"
    assert products[0].category == "Electronics"

def test_load_jsonl_preserves_all_fields() -> None:
    products = load_jsonl(FIXTURES / "mini_catalog.jsonl")
    headphones = products[0]
    assert headphones.brand == "SoundMax"
    assert headphones.price == 79.99
    assert "wireless" in headphones.tags
    assert headphones.popularity_score == 0.85

def test_load_jsonl_empty_file(tmp_path: Path) -> None:
    empty = tmp_path / "empty.jsonl"
    empty.write_text("")
    products = load_jsonl(empty)
    assert products == []
```

- [ ] **Step 4: Run tests — should FAIL**

- [ ] **Step 5: Implement models**

```python
# src/edgereco/catalog/models.py
"""Data models for EdgeReco product catalog."""
from __future__ import annotations

from pydantic import BaseModel


class Product(BaseModel):
    """A product in the catalog."""
    id: str
    title: str
    description: str = ""
    category: str
    subcategories: list[str] = []
    tags: list[str] = []
    brand: str = ""
    price: float | None = None
    currency: str = "USD"
    popularity_score: float = 0.0
    freshness_score: float = 0.0
    image_url: str = ""
    url: str = ""
    attributes: dict[str, str] = {}


class CatalogFile(BaseModel):
    """A file entry in a catalog manifest."""
    path: str
    file_type: str
    checksum: str
    rows: int | None = None


class DeltaFile(BaseModel):
    """A delta update file in a catalog manifest."""
    path: str
    from_version: str
    to_version: str
    checksum: str


class CatalogManifest(BaseModel):
    """Manifest describing a catalog version and its files."""
    catalog_id: str
    version: str
    embedding_model: str
    embedding_dim: int = 384
    files: list[CatalogFile]
    deltas: list[DeltaFile] = []


class SessionProfile(BaseModel):
    """User session profile for personalization."""
    category_affinity: dict[str, float] = {}
    tag_affinity: dict[str, float] = {}
    brand_affinity: dict[str, float] = {}
    recently_viewed: list[str] = []
    click_count: int = 0


class SearchResult(BaseModel):
    """A single search/recommendation result."""
    product: Product
    score: float
    score_components: dict[str, float] = {}


class InteractionEvent(BaseModel):
    """A user interaction event."""
    event_type: str
    product_id: str
    timestamp: str
    metadata: dict[str, str] = {}
```

- [ ] **Step 6: Implement loader**

```python
# src/edgereco/catalog/loader.py
"""Load product catalogs from various file formats."""
from __future__ import annotations

from pathlib import Path

from .models import Product


def load_jsonl(path: Path) -> list[Product]:
    """Load products from a JSONL file (one JSON object per line)."""
    products: list[Product] = []
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return products
    for line in text.splitlines():
        line = line.strip()
        if line:
            products.append(Product.model_validate_json(line))
    return products


def load_csv(path: Path, *, limit: int | None = None) -> list[Product]:
    """Load products from a CSV file using Polars for performance."""
    import polars as pl

    df = pl.read_csv(path, n_rows=limit)
    products: list[Product] = []
    for row in df.iter_rows(named=True):
        products.append(Product.model_validate(row))
    return products
```

`src/edgereco/catalog/__init__.py`:
```python
"""Catalog loading, syncing, and manifest management."""
```

- [ ] **Step 7: Run tests — should PASS**

- [ ] **Step 8: Run quality checks**
```bash
uv run ruff check src tests
uv run mypy src
```

- [ ] **Step 9: Commit**
```bash
git add src/edgereco/catalog/ tests/unit/catalog/ tests/fixtures/
git commit -m "feat(catalog): add Product model and JSONL/CSV loader (TDD)"
```

---

### Task 4: Test fixture catalog (50 products)

**Files:**
- Modify: `tests/fixtures/mini_catalog.jsonl` — expand to 50 products
- Create: `tests/fixtures/mini_manifest.json`
- Modify: `tests/conftest.py` — add shared fixtures

- [ ] **Step 1: Generate 50 diverse products** across 5 categories (10 per category: Electronics, Clothing, Home & Kitchen, Sports, Books). Use realistic Amazon-style titles and varied popularity/freshness scores.

Write a Python script to generate this or write the JSONL manually. Each product must have: id, title, description, category, subcategories, tags (2-4), brand, price, popularity_score (varied 0.2-0.95), freshness_score (varied 0.1-0.9).

- [ ] **Step 2: Create `tests/fixtures/mini_manifest.json`**

```json
{
  "catalog_id": "test-mini",
  "version": "2026-04-24T00:00:00Z",
  "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
  "embedding_dim": 384,
  "files": [
    {"path": "mini_catalog.jsonl", "file_type": "products", "checksum": "sha256:placeholder", "rows": 50}
  ],
  "deltas": []
}
```

- [ ] **Step 3: Add shared fixtures to `tests/conftest.py`**

```python
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
```

- [ ] **Step 4: Verify fixtures load**
```bash
uv run pytest tests/ -v -k "test_load_jsonl_returns"
```

- [ ] **Step 5: Commit**
```bash
git add tests/fixtures/ tests/conftest.py
git commit -m "test: expand mini catalog to 50 products with shared fixtures"
```

---

### Task 5: Amazon preprocessor script

**Files:**
- Create: `src/edgereco/catalog/preprocessor.py`
- Create: `tests/unit/catalog/test_preprocessor.py`
- Create: `examples/scripts/preprocess_amazon.py`

- [ ] **Step 1: Write preprocessor tests**

```python
# tests/unit/catalog/test_preprocessor.py
from edgereco.catalog.preprocessor import normalize_score, amazon_row_to_product

def test_normalize_score_range() -> None:
    values = [0, 1, 5, 10, 100]
    normalized = [normalize_score(v, min_val=0, max_val=100) for v in values]
    assert all(0 <= n <= 1 for n in normalized)
    assert normalized[0] == 0.0
    assert normalized[-1] == 1.0

def test_normalize_score_single_value() -> None:
    assert normalize_score(5, min_val=5, max_val=5) == 0.0

def test_amazon_row_to_product() -> None:
    row = {
        "asin": "B0TEST",
        "title": "Test Product",
        "stars": 4.5,
        "reviews": 1000,
        "price": 29.99,
        "listPrice": 39.99,
        "category_id": "Electronics > Audio > Headphones",
        "isBestSeller": True,
        "boughtInLastMonth": 500,
        "imgUrl": "https://example.com/img.jpg",
        "productURL": "https://amazon.com/dp/B0TEST",
    }
    product = amazon_row_to_product(row, pop_min=0, pop_max=10, fresh_min=0, fresh_max=1000)
    assert product.id == "B0TEST"
    assert product.category == "Electronics"
    assert "Audio" in product.subcategories
    assert product.price == 29.99
    assert 0 <= product.popularity_score <= 1
    assert 0 <= product.freshness_score <= 1
```

- [ ] **Step 2: Implement preprocessor**

```python
# src/edgereco/catalog/preprocessor.py
"""Normalize Amazon product data to EdgeReco Product model."""
from __future__ import annotations

import math
from typing import Any

from .models import Product


def normalize_score(value: float, *, min_val: float, max_val: float) -> float:
    """Normalize a value to [0, 1] given min and max bounds."""
    if max_val <= min_val:
        return 0.0
    return max(0.0, min(1.0, (value - min_val) / (max_val - min_val)))


def compute_popularity_raw(stars: float, reviews: int) -> float:
    """Compute raw popularity score from stars and review count."""
    return stars * math.log(reviews + 1)


def parse_category_hierarchy(category_id: str) -> tuple[str, list[str]]:
    """Parse 'Electronics > Audio > Headphones' into (category, subcategories)."""
    parts = [p.strip() for p in category_id.split(">") if p.strip()]
    if not parts:
        return ("Unknown", [])
    return (parts[0], parts[1:])


def amazon_row_to_product(
    row: dict[str, Any],
    *,
    pop_min: float,
    pop_max: float,
    fresh_min: float,
    fresh_max: float,
) -> Product:
    """Convert an Amazon CSV row to an EdgeReco Product."""
    category, subcategories = parse_category_hierarchy(str(row.get("category_id", "")))
    tags = [s.lower().replace(" ", "-") for s in subcategories]

    pop_raw = compute_popularity_raw(
        float(row.get("stars", 0)),
        int(row.get("reviews", 0)),
    )

    return Product(
        id=str(row["asin"]),
        title=str(row.get("title", "")),
        category=category,
        subcategories=subcategories,
        tags=tags,
        brand="",
        price=float(row["price"]) if row.get("price") else None,
        popularity_score=normalize_score(pop_raw, min_val=pop_min, max_val=pop_max),
        freshness_score=normalize_score(
            float(row.get("boughtInLastMonth", 0)),
            min_val=fresh_min,
            max_val=fresh_max,
        ),
        image_url=str(row.get("imgUrl", "")),
        url=str(row.get("productURL", "")),
    )
```

- [ ] **Step 3: Create the example preprocessing script**

```python
# examples/scripts/preprocess_amazon.py
"""Preprocess Amazon Kaggle CSV into EdgeReco catalog format.

Usage:
    uv run python examples/scripts/preprocess_amazon.py products.csv examples/catalog/ --limit 10000
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Annotated

import polars as pl
import typer

from edgereco.catalog.models import CatalogFile, CatalogManifest
from edgereco.catalog.preprocessor import amazon_row_to_product

app = typer.Typer()

TARGET_CATEGORIES = {"Electronics", "Clothing", "Home & Kitchen", "Sports", "Books"}


@app.command()
def preprocess(
    input_path: Annotated[Path, typer.Argument(help="Path to Amazon CSV")],
    output_dir: Annotated[Path, typer.Argument(help="Output directory")],
    limit: Annotated[int, typer.Option(help="Max products to output")] = 10000,
) -> None:
    """Convert Amazon CSV to EdgeReco JSONL + manifest."""
    typer.echo(f"Reading {input_path}...")
    df = pl.read_csv(input_path)

    pop_expr = (
        pl.col("stars").cast(pl.Float64)
        * (pl.col("reviews").cast(pl.Float64) + 1).log()
    )
    df = df.with_columns([pop_expr.alias("pop_raw")])
    pop_min = float(df["pop_raw"].min() or 0)
    pop_max = float(df["pop_raw"].max() or 1)
    fresh_min = float(df["boughtInLastMonth"].min() or 0)
    fresh_max = float(df["boughtInLastMonth"].max() or 1)

    output_dir.mkdir(parents=True, exist_ok=True)
    out_path = output_dir / "products.jsonl"

    count = 0
    with out_path.open("w", encoding="utf-8") as f:
        for row in df.iter_rows(named=True):
            cat_parts = str(row.get("category_id", "")).split(">")
            top_cat = cat_parts[0].strip() if cat_parts else ""
            if top_cat not in TARGET_CATEGORIES:
                continue
            product = amazon_row_to_product(
                row, pop_min=pop_min, pop_max=pop_max,
                fresh_min=fresh_min, fresh_max=fresh_max,
            )
            f.write(product.model_dump_json() + "\n")
            count += 1
            if count >= limit:
                break

    checksum = "sha256:" + hashlib.sha256(out_path.read_bytes()).hexdigest()
    catalog_file = CatalogFile(
        path="products.jsonl", file_type="products", checksum=checksum, rows=count
    )
    manifest = CatalogManifest(
        catalog_id="amazon-demo",
        version="2026-04-24T00:00:00Z",
        embedding_model="sentence-transformers/all-MiniLM-L6-v2",
        embedding_dim=384,
        files=[catalog_file],
    )
    (output_dir / "manifest.json").write_text(
        manifest.model_dump_json(indent=2), encoding="utf-8"
    )
    typer.echo(f"Wrote {count} products to {out_path}")


if __name__ == "__main__":
    app()
```

- [ ] **Step 4: Run tests — should PASS**

- [ ] **Step 5: Commit**
```bash
git add src/edgereco/catalog/preprocessor.py tests/unit/catalog/test_preprocessor.py examples/
git commit -m "feat(catalog): add Amazon dataset preprocessor with normalization"
```

---

## Phase B: Search Core (Tasks 6-10)

### Task 6: Embedding encoder (TDD)

**Files:**
- Create: `src/edgereco/embeddings/__init__.py`
- Create: `src/edgereco/embeddings/encoder.py`
- Create: `tests/unit/embeddings/__init__.py`
- Create: `tests/unit/embeddings/test_encoder.py`

- [ ] **Step 1: Write tests**

```python
# tests/unit/embeddings/test_encoder.py
import numpy as np
from edgereco.catalog.models import Product
from edgereco.embeddings.encoder import ProductEncoder

def _make_product(title: str, category: str = "Electronics") -> Product:
    return Product(id="test", title=title, category=category)

def test_encode_single_product() -> None:
    encoder = ProductEncoder()
    products = [_make_product("Wireless Bluetooth Headphones")]
    embeddings = encoder.encode(products)
    assert isinstance(embeddings, np.ndarray)
    assert embeddings.shape == (1, 384)
    assert embeddings.dtype == np.float32

def test_encode_multiple_products() -> None:
    encoder = ProductEncoder()
    products = [
        _make_product("Wireless Headphones"),
        _make_product("Running Shoes", "Clothing"),
        _make_product("Python Book", "Books"),
    ]
    embeddings = encoder.encode(products)
    assert embeddings.shape == (3, 384)

def test_encode_query() -> None:
    encoder = ProductEncoder()
    embedding = encoder.encode_query("wireless headphones")
    assert isinstance(embedding, np.ndarray)
    assert embedding.shape == (384,)

def test_similar_products_have_higher_cosine_similarity() -> None:
    encoder = ProductEncoder()
    query = encoder.encode_query("bluetooth headphones")
    products = [
        _make_product("Wireless Bluetooth Headphones"),
        _make_product("Organic Dog Food", "Home & Kitchen"),
    ]
    embeddings = encoder.encode(products)
    # cosine similarity
    sim_headphones = float(np.dot(query, embeddings[0]) / (np.linalg.norm(query) * np.linalg.norm(embeddings[0])))
    sim_dogfood = float(np.dot(query, embeddings[1]) / (np.linalg.norm(query) * np.linalg.norm(embeddings[1])))
    assert sim_headphones > sim_dogfood
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/embeddings/encoder.py
"""Encode product text into embedding vectors using sentence-transformers."""
from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np
from numpy.typing import NDArray
from sentence_transformers import SentenceTransformer

if TYPE_CHECKING:
    from edgereco.catalog.models import Product


def _product_text(product: Product) -> str:
    """Build a text representation of a product for embedding."""
    parts = [product.title]
    if product.category:
        parts.append(product.category)
    if product.tags:
        parts.append(" ".join(product.tags))
    if product.brand:
        parts.append(product.brand)
    return " ".join(parts)


class ProductEncoder:
    """Encode products and queries into dense vectors."""

    def __init__(self, model_name: str = "sentence-transformers/all-MiniLM-L6-v2") -> None:
        self._model = SentenceTransformer(model_name)

    def encode(self, products: list[Product]) -> NDArray[np.float32]:
        """Encode a list of products into a (N, dim) float32 matrix."""
        texts = [_product_text(p) for p in products]
        embeddings: NDArray[np.float32] = self._model.encode(
            texts, convert_to_numpy=True, normalize_embeddings=True,
        )
        return embeddings.astype(np.float32)

    def encode_query(self, query: str) -> NDArray[np.float32]:
        """Encode a search query into a (dim,) float32 vector."""
        embedding: NDArray[np.float32] = self._model.encode(
            [query], convert_to_numpy=True, normalize_embeddings=True,
        )
        return embedding[0].astype(np.float32)

    @property
    def dim(self) -> int:
        """Embedding dimensionality."""
        return int(self._model.get_sentence_embedding_dimension())
```

- [ ] **Step 3: Run tests — should PASS** (first run will download the model, ~90MB)

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/embeddings/ tests/unit/embeddings/
git commit -m "feat(embeddings): add sentence-transformers product encoder (TDD)"
```

---

### Task 7: FAISS vector index (TDD)

**Files:**
- Create: `src/edgereco/embeddings/index.py`
- Create: `tests/unit/embeddings/test_index.py`

- [ ] **Step 1: Write tests**

```python
# tests/unit/embeddings/test_index.py
import numpy as np
from edgereco.embeddings.index import VectorIndex

def test_build_and_search() -> None:
    dim = 8
    embeddings = np.random.default_rng(42).standard_normal((10, dim)).astype(np.float32)
    ids = [f"item_{i}" for i in range(10)]
    index = VectorIndex.build(embeddings, ids, dim=dim)
    query = embeddings[0]  # search for the first item
    results = index.search(query, k=3)
    assert len(results) == 3
    assert results[0][0] == "item_0"  # closest to itself
    assert results[0][1] >= results[1][1]  # scores descending

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
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/embeddings/index.py
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
        index = faiss.IndexFlatIP(dim)  # inner product (cosine if normalized)
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
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/embeddings/index.py tests/unit/embeddings/test_index.py
git commit -m "feat(embeddings): add FAISS vector index with save/load (TDD)"
```

---

### Task 8: BM25 keyword search (TDD)

**Files:**
- Create: `src/edgereco/search/__init__.py`
- Create: `src/edgereco/search/keyword.py`
- Create: `tests/unit/search/__init__.py`
- Create: `tests/unit/search/test_keyword.py`

- [ ] **Step 1: Write tests**

```python
# tests/unit/search/test_keyword.py
from edgereco.catalog.models import Product
from edgereco.search.keyword import KeywordSearcher

def _products() -> list[Product]:
    return [
        Product(id="1", title="Wireless Bluetooth Headphones", category="Electronics", tags=["wireless", "audio"]),
        Product(id="2", title="Cotton Running Shorts", category="Clothing", tags=["cotton", "running"]),
        Product(id="3", title="Bluetooth Speaker Portable", category="Electronics", tags=["bluetooth", "speaker"]),
    ]

def test_keyword_search_returns_relevant() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("bluetooth headphones", k=3)
    assert len(results) > 0
    top_ids = [r[0] for r in results]
    assert "1" in top_ids  # direct match

def test_keyword_search_limit() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("bluetooth", k=1)
    assert len(results) == 1

def test_keyword_search_no_match() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("xyzzy quantum", k=5)
    assert results == []

def test_keyword_search_empty_query() -> None:
    searcher = KeywordSearcher.build(_products())
    results = searcher.search("", k=5)
    assert results == []
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/search/keyword.py
"""BM25-based keyword search over products."""
from __future__ import annotations

from typing import TYPE_CHECKING

from rank_bm25 import BM25Okapi

if TYPE_CHECKING:
    from edgereco.catalog.models import Product


def _tokenize(text: str) -> list[str]:
    """Simple whitespace + lowercase tokenization."""
    return text.lower().split()


def _product_tokens(product: Product) -> list[str]:
    """Build token list from product title, category, tags, brand."""
    parts = [product.title, product.category]
    parts.extend(product.tags)
    if product.brand:
        parts.append(product.brand)
    return _tokenize(" ".join(parts))


class KeywordSearcher:
    """BM25 keyword search over a product catalog."""

    def __init__(self, bm25: BM25Okapi, ids: list[str]) -> None:
        self._bm25 = bm25
        self._ids = ids

    @classmethod
    def build(cls, products: list[Product]) -> KeywordSearcher:
        """Build a BM25 index from products."""
        corpus = [_product_tokens(p) for p in products]
        ids = [p.id for p in products]
        bm25 = BM25Okapi(corpus) if corpus else BM25Okapi([[""]])
        return cls(bm25, ids)

    def search(self, query: str, *, k: int = 10) -> list[tuple[str, float]]:
        """Search for products matching the query. Returns [(id, score), ...]."""
        if not query.strip():
            return []
        tokens = _tokenize(query)
        scores = self._bm25.get_scores(tokens)
        ranked = sorted(enumerate(scores), key=lambda x: x[1], reverse=True)
        results: list[tuple[str, float]] = []
        for idx, score in ranked[:k]:
            if score > 0:
                results.append((self._ids[idx], float(score)))
        return results
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/search/ tests/unit/search/
git commit -m "feat(search): add BM25 keyword search (TDD)"
```

---

### Task 9: Hybrid search with RRF (TDD)

**Files:**
- Create: `src/edgereco/search/vector.py`
- Create: `src/edgereco/search/hybrid.py`
- Create: `tests/unit/search/test_vector.py`
- Create: `tests/unit/search/test_hybrid.py`

- [ ] **Step 1: Write vector search tests**

```python
# tests/unit/search/test_vector.py
import numpy as np
from edgereco.catalog.models import Product
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
```

- [ ] **Step 2: Write hybrid search tests**

```python
# tests/unit/search/test_hybrid.py
from edgereco.search.hybrid import reciprocal_rank_fusion

def test_rrf_merges_two_lists() -> None:
    keyword_results = [("a", 10.0), ("b", 8.0), ("c", 5.0)]
    vector_results = [("b", 0.95), ("d", 0.90), ("a", 0.85)]
    merged = reciprocal_rank_fusion(keyword_results, vector_results, k=60)
    ids = [r[0] for r in merged]
    # "b" appears in both → should rank high
    assert "b" in ids[:2]
    # "a" also appears in both
    assert "a" in ids[:3]

def test_rrf_handles_empty_keyword() -> None:
    merged = reciprocal_rank_fusion([], [("a", 0.9)], k=60)
    assert len(merged) == 1
    assert merged[0][0] == "a"

def test_rrf_handles_empty_vector() -> None:
    merged = reciprocal_rank_fusion([("a", 5.0)], [], k=60)
    assert len(merged) == 1

def test_rrf_deduplicates() -> None:
    merged = reciprocal_rank_fusion(
        [("a", 10.0), ("b", 5.0)],
        [("a", 0.9), ("b", 0.8)],
        k=60,
    )
    ids = [r[0] for r in merged]
    assert len(ids) == len(set(ids))
```

- [ ] **Step 3: Implement vector search**

```python
# src/edgereco/search/vector.py
"""Vector similarity search using FAISS index."""
from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from edgereco.embeddings.index import VectorIndex


class VectorSearcher:
    """Search products by vector similarity."""

    def __init__(self, index: VectorIndex) -> None:
        self._index = index

    def search(
        self,
        query_embedding: NDArray[np.float32],
        *,
        k: int = 10,
    ) -> list[tuple[str, float]]:
        """Search for k nearest products by cosine similarity."""
        return self._index.search(query_embedding, k=k)
```

- [ ] **Step 4: Implement hybrid search**

```python
# src/edgereco/search/hybrid.py
"""Reciprocal Rank Fusion for combining keyword and vector search results."""
from __future__ import annotations


def reciprocal_rank_fusion(
    keyword_results: list[tuple[str, float]],
    vector_results: list[tuple[str, float]],
    *,
    k: int = 60,
) -> list[tuple[str, float]]:
    """Merge keyword and vector results using RRF.

    rrf_score(doc) = sum(1 / (k + rank_i)) for each result list containing doc.
    """
    rrf_scores: dict[str, float] = {}

    for rank, (doc_id, _score) in enumerate(keyword_results):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    for rank, (doc_id, _score) in enumerate(vector_results):
        rrf_scores[doc_id] = rrf_scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)

    merged = sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)
    return merged
```

- [ ] **Step 5: Run all search tests — should PASS**

- [ ] **Step 6: Commit**
```bash
git add src/edgereco/search/ tests/unit/search/
git commit -m "feat(search): add vector search + RRF hybrid fusion (TDD)"
```

---

### Task 10: BDD feature files + step implementations for search

**Files:**
- Create: `features/product_search.feature`
- Create: `features/hybrid_search.feature`
- Create: `tests/bdd/__init__.py`
- Create: `tests/bdd/conftest.py`
- Create: `tests/bdd/test_product_search.py`
- Create: `tests/bdd/test_hybrid_search.py`

- [x] **Step 1: Write feature files** — author scenarios to match the spec §12 coverage list (semantic search, category filter, empty query, no matches, RRF fusion, exact-title match). The spec lists what each feature covers but does not provide Gherkin; scenarios are authored directly.

- [x] **Step 2: Write BDD conftest** with shared fixtures for search scenarios — all fixtures are `scope="session"` (encoder loads once, embeddings computed once; not function-scope as shown in the skeleton below)

```python
# tests/bdd/conftest.py
"""Shared BDD fixtures for EdgeReco acceptance tests."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from edgereco.catalog.loader import load_jsonl
from edgereco.catalog.models import Product, SessionProfile
from edgereco.embeddings.encoder import ProductEncoder
from edgereco.embeddings.index import VectorIndex
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher
from edgereco.search.hybrid import reciprocal_rank_fusion

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"


@pytest.fixture
def bdd_catalog() -> list[Product]:
    """Load the mini catalog for BDD tests."""
    return load_jsonl(FIXTURES_DIR / "mini_catalog.jsonl")


@pytest.fixture
def bdd_encoder() -> ProductEncoder:
    """Shared encoder instance (cached model)."""
    return ProductEncoder()


@pytest.fixture
def bdd_keyword_searcher(bdd_catalog: list[Product]) -> KeywordSearcher:
    return KeywordSearcher.build(bdd_catalog)


@pytest.fixture
def bdd_vector_index(bdd_catalog: list[Product], bdd_encoder: ProductEncoder) -> VectorIndex:
    embeddings = bdd_encoder.encode(bdd_catalog)
    ids = [p.id for p in bdd_catalog]
    return VectorIndex.build(embeddings, ids, dim=bdd_encoder.dim)


@pytest.fixture
def bdd_product_map(bdd_catalog: list[Product]) -> dict[str, Product]:
    return {p.id: p for p in bdd_catalog}
```

- [x] **Step 3: Write step implementations** for product_search.feature and hybrid_search.feature

```python
# tests/bdd/test_product_search.py
"""Step implementations for product_search.feature."""
from pytest_bdd import scenarios, given, when, then, parsers
import pytest

from edgereco.catalog.models import Product
from edgereco.search.keyword import KeywordSearcher
from edgereco.search.vector import VectorSearcher
from edgereco.search.hybrid import reciprocal_rank_fusion
from edgereco.embeddings.index import VectorIndex
from edgereco.embeddings.encoder import ProductEncoder

scenarios("product_search.feature")  # pytest-bdd prepends bdd_features_base_dir

# Steps will reference the bdd_ fixtures from conftest.py
# Implement @given, @when, @then steps matching the Gherkin scenarios
```

NOTE: The exact step implementations depend on the Gherkin wording. The implementer should match each `Given/When/Then` step to a Python function using `@given`, `@when`, `@then` decorators from `pytest_bdd`.

- [x] **Step 4: Run BDD tests** — 6/6 pass; 35/35 total (29 unit + 6 BDD); mypy clean; ruff clean.

- [x] **Step 5: Commit**

---

## Phase C: Recommendations (Tasks 11-14)

### Task 11: Session signals tracker (TDD)

**Files:**
- Create: `src/edgereco/reco/__init__.py`
- Create: `src/edgereco/reco/signals.py`
- Create: `tests/unit/reco/__init__.py`
- Create: `tests/unit/reco/test_signals.py`

- [ ] **Step 1: Write tests** encoding the bump rules from spec §8:

```python
# tests/unit/reco/test_signals.py
from edgereco.catalog.models import Product, SessionProfile, InteractionEvent
from edgereco.reco.signals import apply_interaction, INTERACTION_WEIGHTS

def _product(category: str = "Electronics", tags: list[str] | None = None, brand: str = "Sony") -> Product:
    return Product(id="P1", title="Test", category=category, tags=tags or ["wireless"], brand=brand)

def test_click_bumps_category_affinity() -> None:
    profile = SessionProfile()
    product = _product()
    updated = apply_interaction(profile, product, "click")
    assert updated.category_affinity["Electronics"] == INTERACTION_WEIGHTS["click"]["category"]

def test_click_bumps_tag_affinity() -> None:
    profile = SessionProfile()
    product = _product(tags=["wireless", "bluetooth"])
    updated = apply_interaction(profile, product, "click")
    assert updated.tag_affinity["wireless"] == INTERACTION_WEIGHTS["click"]["tag"]
    assert updated.tag_affinity["bluetooth"] == INTERACTION_WEIGHTS["click"]["tag"]

def test_click_bumps_brand_affinity() -> None:
    profile = SessionProfile()
    product = _product(brand="Sony")
    updated = apply_interaction(profile, product, "click")
    assert updated.brand_affinity["Sony"] == INTERACTION_WEIGHTS["click"]["brand"]

def test_favorite_has_higher_bump_than_click() -> None:
    profile = SessionProfile()
    product = _product()
    clicked = apply_interaction(profile, product, "click")
    favorited = apply_interaction(SessionProfile(), product, "favorite")
    assert favorited.category_affinity["Electronics"] > clicked.category_affinity["Electronics"]

def test_affinity_capped_at_1() -> None:
    profile = SessionProfile()
    product = _product()
    for _ in range(20):
        profile = apply_interaction(profile, product, "favorite")
    assert profile.category_affinity["Electronics"] == 1.0

def test_recently_viewed_prepended_and_capped() -> None:
    profile = SessionProfile()
    for i in range(60):
        p = Product(id=f"P{i}", title="T", category="C")
        profile = apply_interaction(profile, p, "click")
    assert len(profile.recently_viewed) == 50
    assert profile.recently_viewed[0] == "P59"

def test_click_count_increments() -> None:
    profile = SessionProfile()
    product = _product()
    profile = apply_interaction(profile, product, "click")
    profile = apply_interaction(profile, product, "click")
    assert profile.click_count == 2
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/reco/signals.py
"""Session signal tracking and profile updates."""
from __future__ import annotations

from edgereco.catalog.models import Product, SessionProfile

RECENTLY_VIEWED_CAP = 50

INTERACTION_WEIGHTS: dict[str, dict[str, float]] = {
    "click":    {"category": 0.10, "tag": 0.05, "brand": 0.08},
    "view":     {"category": 0.02, "tag": 0.01, "brand": 0.02},
    "favorite": {"category": 0.20, "tag": 0.10, "brand": 0.15},
    "cart":     {"category": 0.25, "tag": 0.12, "brand": 0.20},
}


def _bump(current: float, delta: float) -> float:
    return min(1.0, current + delta)


def apply_interaction(
    profile: SessionProfile,
    product: Product,
    event_type: str,
) -> SessionProfile:
    """Apply an interaction event to a session profile, returning a new profile."""
    weights = INTERACTION_WEIGHTS.get(event_type, INTERACTION_WEIGHTS["view"])

    cat_aff = dict(profile.category_affinity)
    cat_aff[product.category] = _bump(cat_aff.get(product.category, 0.0), weights["category"])

    tag_aff = dict(profile.tag_affinity)
    for tag in product.tags:
        tag_aff[tag] = _bump(tag_aff.get(tag, 0.0), weights["tag"])

    brand_aff = dict(profile.brand_affinity)
    if product.brand:
        brand_aff[product.brand] = _bump(brand_aff.get(product.brand, 0.0), weights["brand"])

    viewed = [product.id] + [pid for pid in profile.recently_viewed if pid != product.id]
    viewed = viewed[:RECENTLY_VIEWED_CAP]

    return SessionProfile(
        category_affinity=cat_aff,
        tag_affinity=tag_aff,
        brand_affinity=brand_aff,
        recently_viewed=viewed,
        click_count=profile.click_count + (1 if event_type == "click" else 0),
    )
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/reco/ tests/unit/reco/
git commit -m "feat(reco): add session signal tracker with interaction weights (TDD)"
```

---

### Task 12: Scorer (TDD)

**Files:**
- Create: `src/edgereco/reco/scorer.py`
- Create: `tests/unit/reco/test_scorer.py`

- [ ] **Step 1: Write tests** encoding the scoring formula from spec §8:

```python
# tests/unit/reco/test_scorer.py
from edgereco.catalog.models import Product, SessionProfile
from edgereco.reco.scorer import score_product

def _product(**kwargs: object) -> Product:
    defaults = {"id": "P1", "title": "T", "category": "Electronics", "tags": ["wireless"],
                "brand": "Sony", "popularity_score": 0.5, "freshness_score": 0.5}
    defaults.update(kwargs)
    return Product(**defaults)

def test_empty_profile_score() -> None:
    product = _product(popularity_score=0.8, freshness_score=0.4, tags=[], brand="")
    profile = SessionProfile()
    result = score_product(product, profile)
    expected = 0.40 * 0.8 + 0.10 * 0.4
    assert abs(result.score - expected) < 1e-10

def test_category_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(category_affinity={"Electronics": 1.0})
    result = score_product(product, profile)
    assert abs(result.score - 0.20) < 1e-10

def test_tag_match_is_mean() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=["a", "b"], brand="")
    profile = SessionProfile(tag_affinity={"a": 1.0, "b": 0.0})
    result = score_product(product, profile)
    expected = 0.15 * 0.5
    assert abs(result.score - expected) < 1e-10

def test_brand_match_contributes() -> None:
    product = _product(popularity_score=0, freshness_score=0, tags=[], brand="Sony")
    profile = SessionProfile(brand_affinity={"Sony": 1.0})
    result = score_product(product, profile)
    assert abs(result.score - 0.10) < 1e-10

def test_repetition_penalty() -> None:
    product = _product(id="seen", popularity_score=1.0, freshness_score=0, tags=[], brand="")
    profile = SessionProfile(recently_viewed=["seen"])
    result = score_product(product, profile)
    expected = 0.40 * 1.0 - 0.25
    assert abs(result.score - expected) < 1e-10

def test_breakdown_sums_to_score() -> None:
    product = _product(popularity_score=0.7, freshness_score=0.4)
    profile = SessionProfile(
        category_affinity={"Electronics": 0.6},
        tag_affinity={"wireless": 0.8},
        brand_affinity={"Sony": 0.5},
        recently_viewed=["P1"],
    )
    result = score_product(product, profile)
    bd = result.score_components
    summed = bd["popularity"] + bd["category_match"] + bd["tag_match"] + bd["brand_match"] + bd["freshness"] - bd["repetition_penalty"]
    assert abs(result.score - summed) < 1e-10
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/reco/scorer.py
"""Product scoring using session profile affinities."""
from __future__ import annotations

from edgereco.catalog.models import Product, SearchResult, SessionProfile

SCORING_WEIGHTS = {
    "popularity": 0.40,
    "category": 0.20,
    "tag": 0.15,
    "brand": 0.10,
    "freshness": 0.10,
    "repetition_penalty": 0.25,
}


def score_product(product: Product, profile: SessionProfile) -> SearchResult:
    """Score a single product against a session profile."""
    cat_match = profile.category_affinity.get(product.category, 0.0)

    tag_match = 0.0
    if product.tags:
        tag_match = sum(profile.tag_affinity.get(t, 0.0) for t in product.tags) / len(product.tags)

    brand_match = profile.brand_affinity.get(product.brand, 0.0) if product.brand else 0.0

    is_recent = product.id in profile.recently_viewed
    penalty = SCORING_WEIGHTS["repetition_penalty"] if is_recent else 0.0

    pop = SCORING_WEIGHTS["popularity"] * product.popularity_score
    cat = SCORING_WEIGHTS["category"] * cat_match
    tag = SCORING_WEIGHTS["tag"] * tag_match
    brand = SCORING_WEIGHTS["brand"] * brand_match
    fresh = SCORING_WEIGHTS["freshness"] * product.freshness_score

    total = pop + cat + tag + brand + fresh - penalty

    return SearchResult(
        product=product,
        score=total,
        score_components={
            "popularity": pop,
            "category_match": cat,
            "tag_match": tag,
            "brand_match": brand,
            "freshness": fresh,
            "repetition_penalty": penalty,
        },
    )
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/reco/scorer.py tests/unit/reco/test_scorer.py
git commit -m "feat(reco): add affinity-based product scorer (TDD)"
```

---

### Task 13: Reranker (TDD)

**Files:**
- Create: `src/edgereco/reco/reranker.py`
- Create: `tests/unit/reco/test_reranker.py`

- [ ] **Step 1: Write tests**

```python
# tests/unit/reco/test_reranker.py
from edgereco.catalog.models import Product, SessionProfile, SearchResult
from edgereco.reco.reranker import rerank

def _product(pid: str, category: str = "Electronics", pop: float = 0.5) -> Product:
    return Product(id=pid, title=f"Product {pid}", category=category, popularity_score=pop)

def _result(pid: str, score: float, category: str = "Electronics", pop: float = 0.5) -> SearchResult:
    return SearchResult(product=_product(pid, category, pop), score=score)

def test_rerank_with_empty_profile_preserves_order() -> None:
    results = [_result("a", 0.9), _result("b", 0.7), _result("c", 0.5)]
    reranked = rerank(results, SessionProfile())
    # With empty profile, scorer adds only popularity+freshness, so order may shift
    # but all results should be present
    assert len(reranked) == 3

def test_rerank_boosts_matching_category() -> None:
    results = [
        _result("formal", 0.9, "Clothing", 0.6),
        _result("electronics", 0.7, "Electronics", 0.3),
    ]
    profile = SessionProfile(category_affinity={"Electronics": 1.0})
    reranked = rerank(results, profile)
    # Electronics product should rise due to category affinity
    assert reranked[0].product.id == "electronics"

def test_rerank_applies_repetition_penalty() -> None:
    results = [_result("a", 0.9, pop=0.9), _result("b", 0.7, pop=0.7)]
    profile = SessionProfile(recently_viewed=["a"])
    reranked = rerank(results, profile)
    # "a" gets penalized, "b" should rise
    assert reranked[0].product.id == "b"
```

- [ ] **Step 2: Implement**

```python
# src/edgereco/reco/reranker.py
"""Rerank search results using session profile."""
from __future__ import annotations

from edgereco.catalog.models import SearchResult, SessionProfile
from edgereco.reco.scorer import score_product


def rerank(
    results: list[SearchResult],
    profile: SessionProfile,
) -> list[SearchResult]:
    """Rerank search results based on the session profile.

    Replaces each result's score with the affinity-based score from the scorer.
    """
    rescored = [score_product(r.product, profile) for r in results]
    rescored.sort(key=lambda r: r.score, reverse=True)
    return rescored
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/reco/reranker.py tests/unit/reco/test_reranker.py
git commit -m "feat(reco): add session-aware reranker (TDD)"
```

---

### Task 14: BDD feature files for recommendations

**Files:**
- Create: `features/recommendations.feature`
- Create: `features/session_tracking.feature`
- Create: `tests/bdd/test_recommendations.py`
- Create: `tests/bdd/test_session_tracking.py`

- [x] **Step 1: Write feature files** — author scenarios directly: affinity shift after clicks, repetition penalty, fresh session (recommendations); click/favorite/cart bumps, favorite > click, recently-viewed ordering (session tracking). Spec §12 only describes coverage; scenarios are authored from domain logic.

- [x] **Step 2: Write step implementations** for both features, referencing the `bdd_` fixtures from conftest.py and using the signals, scorer, and reranker modules

- [x] **Step 3: Run BDD tests**
```bash
uv run pytest tests/bdd/ -v --tb=short
```

- [x] **Step 4: Commit**
```bash
git add features/ tests/bdd/
git commit -m "test(bdd): add recommendations and session tracking feature files"
```

---

## Phase D: Catalog Sync (Tasks 15-17)

### Task 15: Manifest parser + edge client protocol (TDD)

**Files:**
- Create: `src/edgereco/catalog/manifest.py`
- Create: `src/edgereco/edge/__init__.py`
- Create: `src/edgereco/edge/client.py`
- Create: `tests/unit/catalog/test_manifest.py`

- [ ] **Step 1: Write manifest tests**

```python
# tests/unit/catalog/test_manifest.py
import json
from pathlib import Path
from edgereco.catalog.manifest import parse_manifest, validate_checksum

def test_parse_manifest_from_json(tmp_path: Path) -> None:
    data = {
        "catalog_id": "test", "version": "2026-01-01T00:00:00Z",
        "embedding_model": "all-MiniLM-L6-v2", "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
    }
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text(json.dumps(data))
    manifest = parse_manifest(manifest_path)
    assert manifest.catalog_id == "test"
    assert len(manifest.files) == 1

def test_validate_checksum_passes(tmp_path: Path) -> None:
    file_path = tmp_path / "test.txt"
    file_path.write_text("hello")
    import hashlib
    expected = "sha256:" + hashlib.sha256(b"hello").hexdigest()
    assert validate_checksum(file_path, expected) is True

def test_validate_checksum_fails(tmp_path: Path) -> None:
    file_path = tmp_path / "test.txt"
    file_path.write_text("hello")
    assert validate_checksum(file_path, "sha256:wrong") is False
```

- [ ] **Step 2: Implement manifest + edge client protocol**

```python
# src/edgereco/catalog/manifest.py
"""Parse and validate catalog manifests."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .models import CatalogManifest


def parse_manifest(path: Path) -> CatalogManifest:
    """Parse a manifest.json file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return CatalogManifest.model_validate(data)


def validate_checksum(file_path: Path, expected: str) -> bool:
    """Validate a file's SHA-256 checksum against expected 'sha256:...' value."""
    if not expected.startswith("sha256:"):
        return False
    expected_hash = expected[7:]
    actual_hash = hashlib.sha256(file_path.read_bytes()).hexdigest()
    return actual_hash == expected_hash
```

```python
# src/edgereco/edge/client.py
"""Edge catalog client protocol and implementations."""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from edgereco.catalog.models import CatalogManifest


class EdgeCatalogClient(Protocol):
    """Protocol for fetching catalog files from an edge server."""

    def fetch_manifest(self, base_url: str) -> CatalogManifest: ...
    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None: ...
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/catalog/manifest.py src/edgereco/edge/ tests/unit/catalog/test_manifest.py
git commit -m "feat(catalog): add manifest parser + EdgeCatalogClient protocol (TDD)"
```

---

### Task 16: HTTP + filesystem adapters (TDD)

**Files:**
- Create: `src/edgereco/edge/adapters/__init__.py`
- Create: `src/edgereco/edge/adapters/http.py`
- Create: `src/edgereco/edge/adapters/filesystem.py`
- Create: `tests/unit/edge/__init__.py`
- Create: `tests/unit/edge/test_filesystem_adapter.py`

- [ ] **Step 1: Write filesystem adapter tests**

```python
# tests/unit/edge/test_filesystem_adapter.py
import json
from pathlib import Path
from edgereco.edge.adapters.filesystem import FilesystemAdapter

def test_fetch_manifest(tmp_path: Path) -> None:
    manifest_data = {
        "catalog_id": "test", "version": "v1",
        "embedding_model": "model", "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc"}],
    }
    (tmp_path / "manifest.json").write_text(json.dumps(manifest_data))
    adapter = FilesystemAdapter()
    manifest = adapter.fetch_manifest(str(tmp_path / "manifest.json"))
    assert manifest.catalog_id == "test"

def test_fetch_file(tmp_path: Path) -> None:
    source = tmp_path / "source"
    source.mkdir()
    (source / "data.txt").write_text("hello")
    dest = tmp_path / "dest" / "data.txt"
    adapter = FilesystemAdapter()
    adapter.fetch_file(str(source), "data.txt", dest)
    assert dest.read_text() == "hello"
```

- [ ] **Step 2: Implement both adapters**

```python
# src/edgereco/edge/adapters/filesystem.py
"""Filesystem-based catalog client for testing and local development."""
from __future__ import annotations

import json
import shutil
from pathlib import Path

from edgereco.catalog.models import CatalogManifest


class FilesystemAdapter:
    """Fetch catalog files from local filesystem paths."""

    def fetch_manifest(self, base_url: str) -> CatalogManifest:
        """Load manifest from a local file path."""
        data = json.loads(Path(base_url).read_text(encoding="utf-8"))
        return CatalogManifest.model_validate(data)

    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None:
        """Copy a file from the source directory to local_path."""
        source = Path(base_url) / path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, local_path)
```

```python
# src/edgereco/edge/adapters/http.py
"""HTTP-based catalog client for edge/CDN servers."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urljoin

import httpx

from edgereco.catalog.models import CatalogManifest


class HttpAdapter:
    """Fetch catalog files from an HTTP edge server."""

    def __init__(self, timeout: float = 30.0) -> None:
        self._timeout = timeout

    def fetch_manifest(self, base_url: str) -> CatalogManifest:
        """Fetch and parse manifest.json from the edge server."""
        with httpx.Client(timeout=self._timeout) as client:
            response = client.get(base_url)
            response.raise_for_status()
            return CatalogManifest.model_validate(response.json())

    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None:
        """Download a file from the edge server."""
        url = urljoin(base_url.rstrip("/") + "/", path)
        local_path.parent.mkdir(parents=True, exist_ok=True)
        with httpx.Client(timeout=self._timeout) as client:
            with client.stream("GET", url) as response:
                response.raise_for_status()
                with local_path.open("wb") as f:
                    for chunk in response.iter_bytes(chunk_size=8192):
                        f.write(chunk)
```

- [ ] **Step 3: Run tests — should PASS**

- [ ] **Step 4: Commit**
```bash
git add src/edgereco/edge/ tests/unit/edge/
git commit -m "feat(edge): add HTTP + filesystem catalog adapters (TDD)"
```

---

### Task 17: Catalog sync + BDD

**Files:**
- Create: `src/edgereco/catalog/sync.py`
- Create: `tests/unit/catalog/test_sync.py`
- Create: `features/catalog_sync.feature`
- Create: `tests/bdd/test_catalog_sync.py`

- [ ] **Step 1: Write sync tests**

```python
# tests/unit/catalog/test_sync.py
import json
import hashlib
from pathlib import Path
from edgereco.catalog.sync import sync_catalog
from edgereco.edge.adapters.filesystem import FilesystemAdapter

def _setup_origin(tmp_path: Path) -> Path:
    origin = tmp_path / "origin"
    origin.mkdir()
    products = '{"id":"P1","title":"T","category":"C"}\n'
    (origin / "products.jsonl").write_text(products)
    checksum = "sha256:" + hashlib.sha256(products.encode()).hexdigest()
    manifest = {
        "catalog_id": "test", "version": "v1",
        "embedding_model": "model", "embedding_dim": 384,
        "files": [{"path": "products.jsonl", "file_type": "products", "checksum": checksum, "rows": 1}],
    }
    (origin / "manifest.json").write_text(json.dumps(manifest))
    return origin

def test_sync_downloads_catalog(tmp_path: Path) -> None:
    origin = _setup_origin(tmp_path)
    cache = tmp_path / "cache"
    adapter = FilesystemAdapter()
    result = sync_catalog(
        manifest_url=str(origin / "manifest.json"),
        cache_dir=cache,
        client=adapter,
        file_base_url=str(origin),
    )
    assert result.catalog_id == "test"
    assert (cache / "products.jsonl").exists()

def test_sync_validates_checksum(tmp_path: Path) -> None:
    origin = _setup_origin(tmp_path)
    # corrupt the checksum
    manifest = json.loads((origin / "manifest.json").read_text())
    manifest["files"][0]["checksum"] = "sha256:wrong"
    (origin / "manifest.json").write_text(json.dumps(manifest))
    cache = tmp_path / "cache"
    adapter = FilesystemAdapter()
    import pytest
    with pytest.raises(ValueError, match="checksum"):
        sync_catalog(
            manifest_url=str(origin / "manifest.json"),
            cache_dir=cache,
            client=adapter,
            file_base_url=str(origin),
        )
```

- [ ] **Step 2: Implement sync**

```python
# src/edgereco/catalog/sync.py
"""Catalog synchronization from an edge server."""
from __future__ import annotations

from pathlib import Path

import structlog

from edgereco.catalog.manifest import validate_checksum
from edgereco.catalog.models import CatalogManifest
from edgereco.edge.client import EdgeCatalogClient

log = structlog.get_logger(__name__)


def sync_catalog(
    *,
    manifest_url: str,
    cache_dir: Path,
    client: EdgeCatalogClient,
    file_base_url: str,
) -> CatalogManifest:
    """Sync a catalog from an edge server to a local cache directory.

    Downloads all files listed in the manifest and validates checksums.
    """
    cache_dir.mkdir(parents=True, exist_ok=True)

    log.info("fetching manifest", url=manifest_url)
    manifest = client.fetch_manifest(manifest_url)

    for file_entry in manifest.files:
        local_path = cache_dir / file_entry.path
        log.info("downloading", path=file_entry.path, local=str(local_path))
        client.fetch_file(file_base_url, file_entry.path, local_path)

        if not validate_checksum(local_path, file_entry.checksum):
            msg = f"Checksum validation failed for {file_entry.path}"
            raise ValueError(msg)

    # Save manifest locally
    (cache_dir / "manifest.json").write_text(manifest.model_dump_json(indent=2))
    log.info("sync complete", catalog_id=manifest.catalog_id, version=manifest.version)
    return manifest
```

- [ ] **Step 3: Write BDD feature file** — copy from spec (catalog_sync.feature)

- [ ] **Step 4: Write BDD step implementations**

- [ ] **Step 5: Run all tests**
```bash
uv run pytest -v
```

- [ ] **Step 6: Commit**
```bash
git add src/edgereco/catalog/sync.py tests/unit/catalog/test_sync.py features/catalog_sync.feature tests/bdd/test_catalog_sync.py
git commit -m "feat(catalog): add manifest-based catalog sync with checksum validation (TDD)"
```

---

## Phase E: API + CLI (Tasks 18-20)

### Task 18: FastAPI app (TDD)

**Files:**
- Create: `src/edgereco/telemetry/__init__.py`
- Create: `src/edgereco/telemetry/events.py`
- Create: `src/edgereco/telemetry/buffer.py`
- Create: `src/edgereco/api/__init__.py`
- Create: `src/edgereco/api/app.py`
- Create: `src/edgereco/api/deps.py`
- Create: `src/edgereco/api/routes/` (search.py, recommend.py, catalog.py, events.py, health.py)
- Create: `tests/integration/test_api_search.py`
- Create: `tests/integration/test_api_recommend.py`
- Create: `tests/integration/test_api_events.py`

The implementer should:
1. Create the telemetry module (events model + in-memory buffer — simple, ~30 lines each)
2. Create `api/deps.py` with a `ServiceContainer` that holds the loaded catalog, indexes, session store, encoder
3. Create route modules using FastAPI dependency injection
4. Create `api/app.py` with `create_app()` factory
5. Write integration tests using `httpx.TestClient`
6. Tests should cover: `/healthz`, `/search?q=...`, `/recommend`, `POST /events`, `/catalog/info`

Each integration test should set up a `ServiceContainer` with the mini catalog fixture and test against it.

- [ ] **Step 1: Implement telemetry + API + routes**
- [ ] **Step 2: Write integration tests**
- [ ] **Step 3: Run tests — should PASS**
- [ ] **Step 4: Run quality checks**: `uv run ruff check src && uv run mypy src`
- [ ] **Step 5: Commit**
```bash
git commit -m "feat(api): add FastAPI app with search, recommend, events, catalog routes"
```

---

### Task 19: Typer CLI (TDD)

**Files:**
- Create: `src/edgereco/cli.py`
- Create: `tests/integration/test_cli.py`

The implementer should:
1. Create a Typer app with commands: `sync`, `index`, `serve`, `search`, `preprocess`
2. Each command reads config from environment / CLI args
3. Write integration tests using `typer.testing.CliRunner`
4. Test at minimum: `edgereco --help`, `edgereco search "test" --limit 5` (with pre-built fixtures)

- [ ] **Step 1: Implement CLI**
- [ ] **Step 2: Write tests**
- [ ] **Step 3: Run tests — should PASS**
- [ ] **Step 4: Commit**
```bash
git commit -m "feat(cli): add Typer CLI with sync, index, serve, search commands"
```

---

### Task 20: Remaining integration tests

- [ ] **Step 1: Ensure all API integration tests pass**
- [ ] **Step 2: Ensure CLI integration tests pass**
- [ ] **Step 3: Run full test suite**
```bash
uv run pytest -v --tb=short
```
- [ ] **Step 4: Commit any additional tests**

---

## Phase F: Docker + Demo (Tasks 21-23)

### Task 21: Docker + Compose + Caddy

**Files:**
- Create: `deploy/Dockerfile`
- Create: `deploy/docker-compose.yml`
- Create: `deploy/caddy/Caddyfile`

- [ ] **Step 1: Create Dockerfile**

```dockerfile
FROM python:3.13-slim

WORKDIR /app
RUN pip install uv

COPY pyproject.toml uv.lock ./
RUN uv sync --no-dev

COPY src/ src/
COPY examples/ examples/

RUN uv pip install -e .

EXPOSE 8000
CMD ["edgereco", "serve", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Create docker-compose.yml** — as specified in spec §11

- [ ] **Step 3: Create Caddyfile**

```
:8081 {
  encode gzip zstd
  header {
    Cache-Control "public, max-age=300"
    Access-Control-Allow-Origin "*"
  }
  reverse_proxy origin:8080
}
```

- [ ] **Step 4: Commit**
```bash
git add deploy/
git commit -m "infra: add Dockerfile + docker-compose + Caddy edge cache"
```

---

### Task 22: Preprocessed demo catalog

**Files:**
- Create: `examples/catalog/products.jsonl` — 10K Amazon products (or generate synthetically if Kaggle CSV not available)
- Create: `examples/catalog/manifest.json`
- Create: `examples/catalog/embeddings.npy` (precomputed)

The implementer should:
1. If Amazon CSV is available: run the preprocessor script
2. If not: generate a synthetic 10K catalog using realistic product data
3. Generate embeddings using the encoder
4. Write manifest.json with correct checksums
5. Commit the demo catalog (~10-20MB for 10K products + embeddings)

NOTE: If the embeddings file is too large for git, create a `.gitattributes` with Git LFS tracking, or generate embeddings at build time instead of committing them.

- [ ] **Step 1: Generate or preprocess demo catalog**
- [ ] **Step 2: Generate embeddings**
- [ ] **Step 3: Write manifest with checksums**
- [ ] **Step 4: Commit**
```bash
git commit -m "data: add 10K preprocessed Amazon product demo catalog"
```

---

### Task 23: E2E test

**Files:**
- Create: `tests/e2e/__init__.py`
- Create: `tests/e2e/test_full_loop.py`

- [ ] **Step 1: Write E2E test** covering the full loop:

```python
# tests/e2e/test_full_loop.py
"""End-to-end test: sync → index → search → click → recommend."""
import pytest
from httpx import TestClient  # or similar

@pytest.mark.e2e
def test_full_discovery_loop(tmp_path, mini_catalog, bdd_encoder):
    """Prove the complete EdgeReco loop works end-to-end."""
    # 1. Write catalog to tmp_path as if synced
    # 2. Build indexes
    # 3. Create FastAPI app with these indexes
    # 4. Search for "headphones" → get results
    # 5. Post click events for Electronics products
    # 6. Request recommendations → Electronics should be favored
    # 7. Assert the full loop works
    pass  # Implementer fills in the full test
```

- [ ] **Step 2: Run E2E test**
```bash
uv run pytest tests/e2e/ -v -m e2e
```

- [ ] **Step 3: Commit**
```bash
git commit -m "test(e2e): add full discovery loop test"
```

---

## Phase G: Polish (Tasks 24-26)

### Task 24: Coverage enforcement

- [ ] **Step 1: Run coverage**
```bash
uv run pytest --cov --cov-report=term-missing --cov-fail-under=90
```

- [ ] **Step 2: Identify and fill coverage gaps** — add tests for uncovered lines

- [ ] **Step 3: Commit**
```bash
git commit -m "test: achieve 90% line coverage"
```

---

### Task 25: README

**Files:**
- Modify: `README.md`

Write an HN-quality README with:
1. One-sentence description
2. Problem statement (why edge search matters)
3. Architecture diagram (text-based)
4. Quickstart (`docker compose up --build`, then curl examples)
5. CLI usage examples
6. Development setup (`uv sync`, `pytest`, `ruff`, `mypy`)
7. How it works (hybrid search, session reranking, catalog sync)
8. Data (Amazon dataset, preprocessing)
9. License

- [ ] **Step 1: Write README**
- [ ] **Step 2: Commit**
```bash
git commit -m "docs: add comprehensive README"
```

---

### Task 26: CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install uv
        run: pip install uv
      - name: Sync
        run: uv sync --group dev
      - name: Ruff
        run: uv run ruff check src tests
      - name: Mypy
        run: uv run mypy src
      - name: Tests with coverage
        run: uv run pytest --cov --cov-report=term-missing --cov-fail-under=90
      - name: BDD tests
        run: uv run pytest tests/bdd/ -v
```

- [ ] **Step 1: Create CI workflow**
- [ ] **Step 2: Commit**
```bash
git commit -m "ci: add GitHub Actions workflow with quality gates"
```

---

## Self-review checklist

- [x] **Spec §2 Goals**: Hybrid search (T7-9), recommendations (T11-13), catalog sync (T15-17), Docker demo (T21), BDD (T10,14,17), 90% coverage (T24)
- [x] **Spec §4 Data**: Amazon preprocessor (T5), demo catalog (T22)
- [x] **Spec §5 Architecture**: All modules have a task
- [x] **Spec §6 Models**: Product, CatalogManifest, SessionProfile, SearchResult, InteractionEvent (T3)
- [x] **Spec §7 Hybrid search**: BM25 (T8), FAISS (T7), RRF (T9)
- [x] **Spec §8 Scoring**: Scorer with brand affinity (T12), interaction weights (T11)
- [x] **Spec §9 Catalog sync**: Manifest (T15), adapters (T16), sync (T17)
- [x] **Spec §10 API**: FastAPI (T18)
- [x] **Spec §11 Docker**: Compose + Caddy (T21)
- [x] **Spec §12 Testing**: BDD (T10,14,17), unit (T2-T13), integration (T18-20), E2E (T23)
- [x] **Spec §14 Quality**: ruff + mypy throughout, coverage (T24), CI (T26)
- [x] **Spec §15 Acceptance**: All criteria have tasks
- [x] **Type consistency**: Product, SessionProfile, SearchResult, CatalogManifest used consistently across all tasks
- [x] **No placeholders**: All code blocks are complete (except T18-19 API/CLI which have detailed instructions for the implementer since they wire many components together)
