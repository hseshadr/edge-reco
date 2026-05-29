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
 examples/catalog (signed bundle)        IN THE BROWSER TAB
 +---------------------------+          +--------------------------------------+
 | origin (static files)     |          | Nimbus SPA (React)                   |
 |  latest / manifest / chunk|          |   sync Worker  -> OPFS -> verify+CAS |
 +------------+--------------+          |   embedder Worker -> all-MiniLM-L6-v2|
              |                          |   engine: BM25 + vector -> RRF      |
        edge (Caddy CDN :8081)  <--------|   session profile (clicks, in-tab)  |
              signed bundle, CORS, cache +--------------------------------------+
```

- **origin** — serves a signed, content-addressed bundle (a `latest` version pointer + immutable `manifest/<hash>` and `chunk/<hash>` objects). A committed 728-product Amazon bundle lives in `backend/examples/catalog/`.
- **edge** — Caddy reverse proxy with the bundle cache policy (immutable chunks, short-TTL pointer).
- **browser tier** — the Nimbus SPA syncs the bundle into OPFS (Worker), verifies it ed25519 + sha256 fail-closed against a SPA-pinned public key, loads `all-MiniLM-L6-v2` via transformers.js, and runs the full hybrid search + session-aware rerank pipeline **in the tab**. No application backend in the request path.
- **edgereco runtime (Python)** — the same engine packaged as a FastAPI app for the server-side use case. Same scoring formula, same sync + verify, same prebuilt FAISS index — the in-browser engine (`@edgeproc/browser`) is parity-tested against it.

## Quickstart — the Nimbus demo (Docker, backend-free)

One command brings up the full backend-free showcase: a static signed-bundle
origin behind a Caddy edge, plus a static Nimbus SPA that syncs the bundle in
its own tab and runs hybrid search + session-aware recommendations entirely
in-browser. **No FastAPI, no Python in the request path.**

```bash
cd frontend && docker compose up --build

# storefront:
open http://localhost:5173
```

You will see the boot screen step through *syncing the signed bundle ->
reassembling the index -> loading the model*, then the 728-product Amazon
storefront. Click a few products: the "Recommended for you" rail re-ranks
toward your taste — **no network round trip per click**. Stop `origin` + `edge`
and reload: the bundle is in OPFS and the model is in the HTTP cache, so it
keeps working offline.

This compose file needs only this repo — no sibling checkouts. The browser does
the search.

For the storefront walkthrough, screenshots, and how to iterate with
`make dev`, see [`frontend/README.md`](frontend/README.md).

## Quickstart — publish → sync → serve (Python API, no Docker)

For the **optional** server-side API variant (the FastAPI runtime, not used by
the headline demo above), reproduce the delivery loop with the bundle CLI:

```bash
cd backend
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

The committed `backend/examples/catalog/` is exactly such an origin (built from the
728-product Amazon catalog), so step 4 alone — pointed at it — serves the demo data.

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

**In the browser.** The same pipeline — sync the signed bundle, verify it
ed25519 + sha256, run BM25 ⊕ vector → RRF → session-rerank — runs in the tab
via the [`@edgeproc/browser`](frontend/packages/edgeproc-browser/README.md)
workspace package. The browser embedder is `Xenova/all-MiniLM-L6-v2` via
transformers.js, the byte-for-byte equivalent of the Python encoder, and the
top-k is parity-tested against the FastAPI runtime over the same bundle. See
[`frontend/README.md`](frontend/README.md) for the storefront over this engine.

## Configuration

Both halves run on safe defaults out of the box — config is opt-in. To see the
full surface and override anything, copy the example files (nothing in them is a
secret):

```bash
cp backend/.env.example backend/.env     # EDGERECO_* recommender + DEMO_* API vars
cp frontend/.env.example frontend/.env   # VITE_BUNDLE_BASE_URL + test tooling
```

Vite auto-loads `frontend/.env`. The backend's `EDGERECO_*` vars are read from
the process environment, so export them first (e.g. `set -a && source .env && set +a`)
or pass them inline as in the publish→sync→serve quickstart above.

## Development

```bash
# Backend (Python recommender)
cd backend
uv sync --group dev
uv run poe gate                                  # lint + type-check + tests + coverage gate

# Frontend (Nimbus storefront + @edgeproc/browser)
cd ../frontend
npm install
npm run lint --workspaces --if-present
npm run typecheck --workspaces --if-present
npm run test --workspaces --if-present
npm run build -w frontend
```

The repo follows strict TDD/BDD: unit tests in `backend/tests/unit/`, BDD scenarios in `backend/features/` with steps in `backend/tests/bdd/`, integration tests in `backend/tests/integration/`, end-to-end in `backend/tests/e2e/`.

## Data

`backend/examples/catalog/` is a committed, signed 728-product **real Amazon catalog** bundle (the demo data). It was produced by `build-catalog` → `index` → `bundle`. To build your own from raw data: a scraped-Amazon `products.csv` goes through `edgereco build-catalog`, or a Kaggle Amazon Products Dataset CSV through `edgereco preprocess INPUT.csv OUTPUT_DIR --limit 10000` (normalizes popularity from `stars × log(reviews+1)` and freshness from `boughtInLastMonth`); then `index` + `bundle` to sign and publish.

## Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current architecture, system context, request lifecycle (with d2 diagrams).
- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — clone → backend gate → frontend test → run the demo end-to-end.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — backend-free vs edge-origin deployment patterns.
- [`docs/diagrams/`](docs/diagrams/) — d2 sources + rendered SVGs.

## Repo layout

- `backend/` — Python project root (`pyproject.toml`, `uv.lock`).
  - `backend/src/edgereco/` — runtime: `catalog/` `embeddings/` `search/` `reco/` `telemetry/` `api/` `cli.py` `config.py`
  - `backend/features/` — Gherkin BDD specs, decoupled from step implementations
  - `backend/tests/` — `unit/` `bdd/` `integration/` `e2e/`
  - `backend/deploy/` — `Dockerfile`, `docker-compose.yml`, Caddy edge config
  - `backend/examples/catalog/` — committed signed 728-product Amazon catalog bundle (`latest` + `manifest/` + `chunk/`)
  - `backend/examples/keys/public.key` — pinned Ed25519 verify key for the bundle
  - `backend/demo_server/` — optional FastAPI API-server launcher (not in main gate)
  - `backend/scripts/` — fixture generators for browser-tier parity tests
- `frontend/` — npm workspace root (`package.json`, `package-lock.json`).
  - `frontend/app/` — Nimbus React storefront (backend-free; syncs + runs the engine in-browser)
  - `frontend/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser sync + hybrid-search engine
- `docs/` — `ARCHITECTURE.md` · `QUICKSTART.md` · `DEPLOY.md` · `diagrams/` · `archive/`

## License

[MIT](LICENSE).
