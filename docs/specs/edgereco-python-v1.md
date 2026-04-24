# EdgeReco Python v1 — Edge Product Discovery

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Approved |
| **Authored** | 2026-04-24 |
| **Companion Plan** | [`../plans/edgereco-python-v1.md`](../plans/edgereco-python-v1.md) |

---

## 1. Thesis

EdgeReco is a Python-first local product search and recommendation engine. The backend trains and publishes product catalogs with embeddings. The edge syncs catalogs, builds local indexes, performs hybrid semantic search, and reranks results using session-aware personalization — zero backend calls after sync.

Positioned as an OSS reference architecture for stateful, edge-first product discovery.

## 2. Goals

1. **Hybrid search** over a real Amazon product catalog (~10K products shipped, 1.4M processable) combining BM25 keyword matching and sentence-transformer vector similarity via Reciprocal Rank Fusion.
2. **Session-aware recommendations** that shift in real-time as the user clicks, views, and favorites products.
3. **Catalog sync** with manifest-based versioning, checksum validation, and delta support from an edge cache (Caddy).
4. **Docker Compose demo** that proves the full architecture in one command: origin → edge cache → EdgeReco runtime.
5. **Professional test suite** with BDD feature files (Gherkin, decoupled), TDD unit tests, integration tests, E2E tests, and ≥90% line coverage.
6. **OSS-grade quality**: strict typing (mypy), comprehensive linting (ruff), clean architecture (Protocol-based DI), HN-quality README.

## 3. Non-goals

- Browser/WASM runtime (future phase)
- Distributed multi-node coordination
- Real-time model training
- User authentication / multi-tenancy
- Production deployment configs (Kubernetes, Terraform)
- Embedding model fine-tuning

## 4. Data: Amazon Products Dataset

**Source:** Kaggle Amazon Products Dataset 2023 (1.4M products, ODC-By license)

**Preprocessing pipeline** (`examples/scripts/preprocess_amazon.py`):

| Step | Action |
|---|---|
| 1 | Read Kaggle CSV (asin, title, imgUrl, productURL, stars, reviews, price, listPrice, category_id, isBestSeller, boughtInLastMonth) |
| 2 | Normalize to EdgeReco `Product` model |
| 3 | Filter to 5 categories: Electronics, Clothing, Home & Kitchen, Sports, Books (~10K for demo) |
| 4 | Compute `popularity_score` = normalize(stars * log(reviews + 1)) to [0, 1] |
| 5 | Compute `freshness_score` = normalize(boughtInLastMonth) to [0, 1] |
| 6 | Extract tags from category hierarchy |
| 7 | Write `products.jsonl` + `manifest.json` |
| 8 | Generate embeddings with all-MiniLM-L6-v2 → `embeddings.npy` |

**Shipped demo:** A preprocessed 10K-product subset in `examples/catalog/` so `docker compose up` works without Kaggle access. The preprocessing script is included for users who want the full 1.4M.

## 5. Architecture

### Component map

```
┌──────────────────────────────────────────────────────┐
│  CLI (Typer)  /  API (FastAPI)                       │
│  edgereco sync | index | serve | search | preprocess │
└──────────┬──────────────┬────────────────────────────┘
           │              │
    ┌──────▼──────┐  ┌────▼─────────────────────┐
    │ catalog     │  │ search                    │
    │  .sync      │  │  .keyword (BM25)          │
    │  .loader    │  │  .vector  (FAISS)         │
    │  .manifest  │  │  .hybrid  (RRF fusion)    │
    └──────┬──────┘  └────┬─────────────────────┘
           │              │
    ┌──────▼──────┐  ┌────▼─────────────────────┐
    │ edge        │  │ embeddings                │
    │  .client    │  │  .encoder (transformers)  │
    │  .adapters/ │  │  .index   (FAISS)         │
    └─────────────┘  └──────────────────────────┘
                          │
                   ┌──────▼──────┐
                   │ reco        │
                   │  .signals   │
                   │  .scorer    │
                   │  .reranker  │
                   └─────────────┘
```

### Module responsibilities

| Module | Does | Depends on |
|---|---|---|
| `catalog.models` | Pydantic models: Product, CatalogManifest, CatalogFile, DeltaFile | — |
| `catalog.loader` | Load products from JSONL/CSV/Parquet → `list[Product]` | `models`, Polars |
| `catalog.preprocessor` | Amazon CSV → EdgeReco JSONL normalization | `models`, Polars |
| `catalog.manifest` | Parse manifest.json, validate checksums | `models` |
| `catalog.sync` | Fetch manifest + files from edge URL, apply deltas | `manifest`, `loader`, `edge.client` |
| `embeddings.encoder` | Encode product text → float32 vectors | sentence-transformers |
| `embeddings.index` | FAISS index: build, save, load, k-NN search | faiss-cpu, numpy |
| `search.keyword` | BM25 search over product title + category + tags | rank-bm25 |
| `search.vector` | Vector similarity search via FAISS | `embeddings.index` |
| `search.hybrid` | Reciprocal Rank Fusion of keyword + vector results | `keyword`, `vector` |
| `reco.signals` | Track session interactions, build affinity profile | `catalog.models` |
| `reco.scorer` | Score products: affinity + popularity + freshness | `signals` |
| `reco.reranker` | Reorder candidates using session context | `scorer` |
| `telemetry.events` | Event models (Pydantic) | — |
| `telemetry.buffer` | In-memory event buffer, optional upstream flush | `events` |
| `edge.client` | `EdgeCatalogClient` Protocol | — |
| `edge.adapters.http` | HTTP/CDN adapter implementing the protocol | httpx |
| `edge.adapters.filesystem` | Local file adapter (testing/dev) | — |
| `api.app` | FastAPI factory with DI | all modules |
| `cli` | Typer CLI: sync, index, serve, search, preprocess | all modules |
| `config` | Pydantic Settings: env-based configuration | pydantic-settings |

## 6. Data models

```python
class Product(BaseModel):
    id: str
    title: str
    description: str = ""
    category: str
    subcategories: list[str] = []
    tags: list[str] = []
    brand: str = ""
    price: float | None = None
    currency: str = "USD"
    popularity_score: float = 0.0    # [0, 1]
    freshness_score: float = 0.0     # [0, 1]
    image_url: str = ""
    url: str = ""
    attributes: dict[str, str] = {}

class CatalogFile(BaseModel):
    path: str
    file_type: str                   # "products" | "embeddings"
    checksum: str                    # "sha256:..."
    rows: int | None = None

class DeltaFile(BaseModel):
    path: str
    from_version: str
    to_version: str
    checksum: str

class CatalogManifest(BaseModel):
    catalog_id: str
    version: str                     # ISO timestamp
    embedding_model: str
    embedding_dim: int = 384
    files: list[CatalogFile]
    deltas: list[DeltaFile] = []

class SessionProfile(BaseModel):
    category_affinity: dict[str, float] = {}
    tag_affinity: dict[str, float] = {}
    brand_affinity: dict[str, float] = {}
    recently_viewed: list[str] = []
    click_count: int = 0

class SearchResult(BaseModel):
    product: Product
    score: float
    score_components: dict[str, float] = {}

class InteractionEvent(BaseModel):
    event_type: str                  # "click" | "view" | "favorite" | "cart"
    product_id: str
    timestamp: str                   # ISO 8601
    metadata: dict[str, str] = {}
```

## 7. Hybrid search design

### Reciprocal Rank Fusion (RRF)

```
rrf_score(doc) = Σ 1 / (k + rank_i(doc))
```

Where `k = 60` (standard constant), and the sum is over keyword rank and vector rank. Documents appearing in only one result set get their single-source rank contribution.

### Search flow

1. Query arrives: `"wireless bluetooth headphones"`
2. **Keyword path:** BM25 over `title + category + tags` → top 100 by BM25 score
3. **Vector path:** Encode query → FAISS k-NN → top 100 by cosine similarity
4. **Fusion:** RRF merge → top `limit` results
5. **Optional rerank:** If session profile exists, apply affinity-based reranking

### Category filter

Applied pre-search: filter the catalog to matching categories, then run hybrid search on the subset.

## 8. Recommendation scoring

Same scoring formula proven in Phase 0, extended with brand affinity:

```
score(product, profile) =
    0.40 * popularity_score
  + 0.20 * category_match
  + 0.15 * tag_match
  + 0.10 * brand_match
  + 0.10 * freshness_score
  - 0.25 * repetition_penalty

category_match = profile.category_affinity[product.category] ?? 0
tag_match      = mean(profile.tag_affinity[tag] ?? 0 for tag in product.tags)
brand_match    = profile.brand_affinity[product.brand] ?? 0
repetition_penalty = 0.25 if product.id in profile.recently_viewed else 0
```

Profile update rules on interaction:

| Event | Category bump | Tag bump (each) | Brand bump | Recently viewed |
|---|---|---|---|---|
| click | +0.10 | +0.05 | +0.08 | prepend, cap 50 |
| view | +0.02 | +0.01 | +0.02 | prepend, cap 50 |
| favorite | +0.20 | +0.10 | +0.15 | prepend, cap 50 |
| cart | +0.25 | +0.12 | +0.20 | prepend, cap 50 |

All affinities capped at 1.0.

## 9. Catalog sync design

### Manifest format

```json
{
  "catalog_id": "amazon-demo",
  "version": "2026-04-24T00:00:00Z",
  "embedding_model": "sentence-transformers/all-MiniLM-L6-v2",
  "embedding_dim": 384,
  "files": [
    {"path": "products.jsonl", "file_type": "products", "checksum": "sha256:abc...", "rows": 10000},
    {"path": "embeddings.npy", "file_type": "embeddings", "checksum": "sha256:def..."}
  ],
  "deltas": [
    {"path": "deltas/delta-20260424.jsonl", "from_version": "2026-04-23T00:00:00Z", "to_version": "2026-04-24T00:00:00Z", "checksum": "sha256:ghi..."}
  ]
}
```

### Sync protocol

1. Fetch `manifest.json` from edge URL
2. Compare local manifest version with remote
3. If no local manifest: full sync (download all files)
4. If local version < remote and delta exists: apply delta
5. If local version < remote and no delta: full sync
6. Validate checksums after download
7. Rebuild indexes after sync

### Edge adapter protocol

```python
class EdgeCatalogClient(Protocol):
    def fetch_manifest(self, base_url: str) -> CatalogManifest: ...
    def fetch_file(self, base_url: str, path: str, local_path: Path) -> None: ...
```

Two implementations: `HttpAdapter` (httpx, for real edge/CDN) and `FilesystemAdapter` (local paths, for testing).

## 10. API design

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/healthz` | — | `{"status": "ok"}` |
| GET | `/search` | `?q=...&limit=10&category=...` | `{"results": [SearchResult], "query": str, "total": int}` |
| GET | `/recommend` | `?limit=10` | `{"results": [SearchResult], "session_clicks": int}` |
| POST | `/events` | `{"events": [InteractionEvent]}` | `{"received": int}` |
| GET | `/catalog/info` | — | `{"catalog_id": str, "version": str, "product_count": int, "index_stats": {...}}` |

Session tracked via `X-Session-Id` header or cookie. In-memory session store (no persistence for v1).

## 11. Docker Compose demo

Three containers proving the full architecture:

| Container | Role | Real-world equivalent |
|---|---|---|
| `origin` | Serves catalog files via HTTP | Product catalog backend / S3 |
| `edge` | Caddy reverse proxy with caching | Akamai, Cloudflare, Fastly |
| `demo` | EdgeReco runtime: sync, index, serve | Edge node / device |

```bash
docker compose up --build
# Then:
curl "http://localhost:8000/search?q=wireless+headphones&limit=5"
curl "http://localhost:8000/recommend?limit=5"
```

## 12. Testing strategy

### Test pyramid

| Layer | Framework | Count target | Coverage |
|---|---|---|---|
| **BDD acceptance** | pytest-bdd + Gherkin features/ | 5 feature files, ~20 scenarios | Validates end-to-end behavior |
| **Unit** | pytest | ~80 tests across all modules | ≥90% line coverage |
| **Integration** | pytest + httpx TestClient | ~15 tests for API endpoints | API contract validation |
| **E2E** | pytest | 1 full-loop test | sync → index → search → click → recommend |

### BDD feature files (Gherkin, decoupled in `features/`)

| Feature file | Covers |
|---|---|
| `product_search.feature` | Semantic search, category filter, empty query, no matches |
| `hybrid_search.feature` | RRF fusion beats keyword-only, exact match still works |
| `recommendations.feature` | Affinity shift after clicks, mixed interactions, session reset |
| `session_tracking.feature` | Click/view/favorite/cart signal tracking, profile updates |
| `catalog_sync.feature` | Initial sync, delta sync, checksum validation |

Step implementations in `tests/bdd/` — one file per feature, shared fixtures in `tests/bdd/conftest.py`.

### TDD discipline

Every module is implemented test-first:
1. Write the BDD feature file (acceptance criteria, Gherkin)
2. Write the unit test (failing)
3. Implement the module until tests pass
4. Run BDD scenarios to verify integration
5. Commit

### Test fixtures

- `tests/fixtures/mini_catalog.jsonl` — 50 diverse products for fast unit tests
- `tests/fixtures/mini_embeddings.npy` — precomputed 384-dim embeddings for the 50 products
- `tests/fixtures/mini_manifest.json` — manifest pointing to the mini files
- `tests/conftest.py` — root fixtures providing loaded catalog, FAISS index, BM25 index, encoder mock

## 13. Tech stack

| Need | Tool | Version |
|---|---|---|
| Language | Python | 3.13 |
| Data models | Pydantic | v2 |
| Dataframes | Polars | latest |
| Vector search | faiss-cpu | latest |
| Embeddings | sentence-transformers | latest |
| Keyword search | rank-bm25 | latest |
| BDD | pytest-bdd | latest |
| API | FastAPI | latest |
| CLI | Typer | latest |
| Config | pydantic-settings | latest |
| HTTP client | httpx | latest |
| Pkg manager | uv | latest |
| Linting | ruff | latest |
| Type checking | mypy | latest, strict |
| Testing | pytest + pytest-cov | latest |
| Edge cache | Caddy | 2-alpine |
| Containers | Docker + Compose | latest |

## 14. Code quality standards

- Python 3.13 strict typing (`mypy --strict`)
- `ruff` with comprehensive rule selection
- No `Any` types in library code (`src/edgereco/`)
- All public functions have return type annotations
- `Protocol`-based dependency injection (no concrete deps in business logic)
- Function size target < 30 lines (max 50)
- Docstrings on all public modules and functions
- ≥90% line coverage enforced via `pytest-cov` thresholds

## 15. Acceptance criteria

1. `uv sync && pytest --cov --cov-report=term-missing` → ≥90% coverage, all tests green including BDD
2. `ruff check src tests` → clean
3. `mypy --strict src` → clean
4. `docker compose up --build` → all three services start
5. `curl localhost:8000/search?q=wireless+headphones` → semantically relevant Amazon products returned
6. `curl -X POST localhost:8000/events ...` + `curl localhost:8000/recommend` → personalized results
7. `edgereco search "running shoes" --limit 5` → CLI works standalone
8. All 5 BDD feature files pass with clear Gherkin output
9. README contains: problem statement, architecture diagram, quickstart, demo walkthrough
