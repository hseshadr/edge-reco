# EdgeReco

A Python-first local product discovery engine. Edge nodes sync a manifest-described catalog, build local indexes, and serve hybrid search + session-aware recommendations — zero backend calls after sync.

## Why

Most search/reco stacks are tightly coupled to a remote backend: every query crosses the network, every reco request rebuilds session state in some service. EdgeReco inverts that: the catalog distributes through a CDN like static assets, the runtime ships as a small Python process, and inference happens locally. Sync once, run anywhere.

## Architecture

```
+----------+   manifest+files   +------------+   sync   +-------------+
|  origin  | ─────────────────► |  edge/CDN  | ───────► |  edgereco   |
+----------+                    +------------+          |   runtime   |
                                                         +------+------+
                                                                │ /search
                                                                │ /recommend
                                                                ▼
                                                            client
```

- **origin** — serves the catalog (`manifest.json` + `products.jsonl`).
- **edge** — Caddy reverse proxy with HTTP cache.
- **edgereco runtime** — FastAPI app with BM25 + FAISS indexes, RRF fusion, session-aware reranker.

## Quickstart (Docker)

```bash
docker compose -f deploy/docker-compose.yml up --build
curl "http://localhost:8000/search?q=wireless+headphones&limit=5"
curl "http://localhost:8000/recommend?limit=5" -H "X-Session-Id: demo"
```

The demo container syncs the 1000-product synthetic catalog from the origin, builds vector + keyword indexes locally, then serves the API.

## Quickstart (local)

```bash
uv sync --group dev

# generate the demo catalog
uv run python scripts/generate_demo_catalog.py

# sync into a local cache (filesystem mode), build indexes, serve
uv run edgereco sync examples/catalog/manifest.json /tmp/cache --filesystem \
    --file-base-url examples/catalog
uv run edgereco index /tmp/cache /tmp/index
uv run edgereco serve /tmp/cache /tmp/index --port 8000
```

## CLI

```
edgereco sync MANIFEST_URL CACHE_DIR [--http|--filesystem] [--file-base-url URL]
edgereco index CACHE_DIR INDEX_DIR
edgereco serve CACHE_DIR INDEX_DIR [--host HOST] [--port PORT]
edgereco search QUERY CACHE_DIR INDEX_DIR [--limit N] [--category CAT] [--json]
edgereco preprocess INPUT.csv OUTPUT_DIR [--limit N]
```

## How it works

**Hybrid search.** BM25 keyword scores and FAISS cosine-similarity scores are merged via Reciprocal Rank Fusion (`rrf_score = Σ 1/(k + rank_i)` over each backend). Keyword catches exact matches; vector catches paraphrases.

**Session-aware reranking.** Click/view/favorite/cart events accumulate per-session affinity for category, tag, and brand. The reranker rescores hybrid candidates as

```
score = 0.40·popularity + 0.20·category_aff + 0.15·tag_aff
      + 0.10·brand_aff + 0.10·freshness − 0.25·repetition
```

Recently-viewed items get penalized; matching categories/brands/tags get amplified.

**Catalog sync.** The origin publishes a `manifest.json` listing files with sha256 checksums. The edge fetches the manifest, downloads each listed file, validates checksums, and writes them to a local cache. After sync, the runtime is fully offline-capable.

## Development

```bash
uv sync --group dev
uv run pytest -q                                 # full suite
uv run pytest --cov=edgereco --cov-fail-under=90 # with coverage gate
uv run ruff check src tests
uv run mypy src
```

The repo follows strict TDD/BDD: unit tests in `tests/unit/`, BDD scenarios in `features/` with steps in `tests/bdd/`, integration tests in `tests/integration/`, end-to-end in `tests/e2e/`.

## Data

`scripts/generate_demo_catalog.py` produces a deterministic 1000-product synthetic catalog (5 categories × 200) suitable for the demo. To use real Amazon Products Dataset (Kaggle), pipe a CSV through `edgereco preprocess INPUT.csv OUTPUT_DIR --limit 10000` — the preprocessor normalizes popularity from `stars × log(reviews+1)` and freshness from `boughtInLastMonth`, then writes JSONL + manifest.

## Specs

- [`docs/superpowers/specs/edgereco-python-v1.md`](docs/superpowers/specs/edgereco-python-v1.md) — design spec.
- [`docs/superpowers/plans/edgereco-python-v1.md`](docs/superpowers/plans/edgereco-python-v1.md) — 26-task implementation plan (executed via `superpowers:subagent-driven-development`).

## License

MIT.
