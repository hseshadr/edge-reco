# EdgeReco

> **Sync once. Run anywhere. Zero backend calls.**

[![CI](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml/badge.svg)](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)

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

- **origin** — serves a signed, content-addressed bundle (a `latest` version pointer + immutable `manifest/<hash>` and `chunk/<hash>` objects). A committed 728-product Amazon bundle lives in `examples/catalog/`.
- **edge** — Caddy reverse proxy with the bundle cache policy (immutable chunks, short-TTL pointer).
- **edgereco runtime** — FastAPI app that syncs + verifies the bundle (fail-closed on a bad signature), `VectorIndex.load`s the prebuilt FAISS index (zero recompute on the edge), then serves BM25 + FAISS RRF hybrid search + a session-aware reranker.

## Quickstart — the Nimbus demo (Docker)

The fastest way to see the full local-first loop: a React storefront over the engine,
serving the **real 728-product Amazon catalog** synced from the CDN.

```bash
# from demo/ — brings up origin -> edge(Caddy) -> backend(sync+serve) -> frontend
cd demo && docker compose up --build

# storefront:
open http://localhost:5173

# the backend synced the signed bundle from the edge and serves real products:
# (run inside the network, or hit the host-mapped port)
#   GET http://localhost:8000/search?q=polo&limit=5      -> real Amazon polo shirts
#   GET http://localhost:8000/catalog/info               -> 728 products
```

The backend syncs the signed bundle from the Caddy edge at startup
(`ServiceContainer.from_synced`), verifies it against the pinned public key, loads the
prebuilt index, and serves — no backend calls after sync. The frontend is unchanged;
it just sees the real catalog.

> Requires the two sibling repos checked out beside this one (`../edgeproc`,
> `../shared-libs-python`) — the backend build context is the parent dir. See the
> header of `demo/docker-compose.yml`.

## Quickstart — publish → sync → serve (local, no Docker)

Reproduce the delivery loop with the bundle CLI:

```bash
uv sync --group dev

# 1. build a catalog jsonl from a scraped-Amazon CSV
uv run edgereco build-catalog products.csv /tmp/staging/products.jsonl

# 2. build the FAISS vector index into the staging dir
uv run edgereco index /tmp/staging /tmp/staging

# 3. sign + publish a content-addressed bundle origin
uv run edgereco bundle /tmp/staging /tmp/origin examples/keys/private.key \
    --catalog-id amazon-demo --version v1 --product-count 728

# 4. serve by syncing that origin (filesystem URL works too) + verifying the key
EDGERECO_BUNDLE_BASE_URL=/tmp/origin \
EDGERECO_VERIFY_KEY_PATH=examples/keys/public.key \
EDGERECO_BUNDLE_CACHE_DIR=/tmp/bundle-cache \
    uv run edgereco serve /tmp/staging /tmp/staging --port 8000
```

The committed `examples/catalog/` is exactly such an origin (built from the 728-product
Amazon catalog), so step 4 alone — pointed at it — serves the demo data.

## CLI

```
edgereco build-catalog INPUT.csv OUTPUT.jsonl           # scraped-Amazon CSV -> products.jsonl
edgereco preprocess INPUT.csv OUTPUT_DIR [--limit N]    # Kaggle-schema CSV -> jsonl + manifest
edgereco index STAGING_DIR INDEX_DIR                    # build FAISS vector/ index
edgereco bundle STAGING_DIR ORIGIN_DIR PRIVATE_KEY      # sign + publish a bundle origin
edgereco serve CACHE_DIR INDEX_DIR [--host HOST] [--port PORT]
    # with EDGERECO_BUNDLE_BASE_URL + EDGERECO_VERIFY_KEY_PATH set, syncs + verifies a
    # signed bundle from that origin instead of reading the flat CACHE_DIR/INDEX_DIR.
edgereco search QUERY CACHE_DIR INDEX_DIR [--limit N] [--category CAT] [--json]
```

## How it works

**Hybrid search.** BM25 keyword scores and FAISS cosine-similarity scores are merged via Reciprocal Rank Fusion (`rrf_score = Σ 1/(k + rank_i)` over each backend). Keyword catches exact matches; vector catches paraphrases.

**Session-aware reranking.** Click/view/favorite/cart events accumulate per-session affinity for category, tag, and brand. The reranker rescores hybrid candidates as

```
score = 0.40·popularity + 0.20·category_aff + 0.15·tag_aff
      + 0.10·brand_aff + 0.10·freshness − 0.25·repetition
```

Recently-viewed items get penalized; matching categories/brands/tags get amplified.

**Catalog sync.** The origin publishes a signed, content-addressed bundle: a `latest` version pointer (Ed25519-signed) → an immutable `manifest/<hash>` → immutable `chunk/<hash>` objects. The edge fetches `/latest`, verifies its signature against the pinned public key (fail-closed on tampering), pulls the listed chunks, reassembles each bundled file — including the prebuilt FAISS `vector/` index — into a local cache, and `VectorIndex.load`s it (zero recompute). After sync, the runtime is fully offline-capable.

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

`examples/catalog/` is a committed, signed 728-product **real Amazon catalog** bundle (the demo data). It was produced by `build-catalog` → `index` → `bundle` (see the publish→sync→serve quickstart above). To build your own from raw data: a scraped-Amazon `products.csv` goes through `edgereco build-catalog`, or a Kaggle Amazon Products Dataset CSV through `edgereco preprocess INPUT.csv OUTPUT_DIR --limit 10000` (normalizes popularity from `stars × log(reviews+1)` and freshness from `boughtInLastMonth`); then `index` + `bundle` to sign and publish.

## Specs

- [`docs/superpowers/specs/edgereco-python-v1.md`](docs/superpowers/specs/edgereco-python-v1.md) — design spec.
- [`docs/superpowers/plans/edgereco-python-v1.md`](docs/superpowers/plans/edgereco-python-v1.md) — 26-task implementation plan (executed via `superpowers:subagent-driven-development`).

## Repo layout

- `src/edgereco/` — runtime: `catalog/` `embeddings/` `search/` `reco/` `telemetry/` `api/` `edge/` `cli.py` `config.py`
- `features/` — Gherkin BDD specs, decoupled from step implementations
- `tests/` — `unit/` `bdd/` `integration/` `e2e/`
- `deploy/` — `Dockerfile`, `docker-compose.yml`, Caddy edge config
- `examples/catalog/` — committed signed 728-product Amazon catalog bundle (`latest` + `manifest/` + `chunk/`)
- `examples/keys/public.key` — pinned Ed25519 verify key for the bundle
- `demo/` — Nimbus React storefront + FastAPI backend (syncs the bundle from the CDN)
- `docs/superpowers/` — current spec + plans
- `docs/legacy/` — pre-pivot TS/WASM design (archive only)

## License

[MIT](LICENSE).
