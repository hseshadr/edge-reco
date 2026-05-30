# EdgeReco

> **Sync once. Run anywhere. Zero backend calls.**

[![CI](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml/badge.svg)](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)

**Nimbus is a pretend online store.** The interesting part: its entire
search-and-recommend brain runs *inside your browser tab* — no server, no
backend calls — after a one-time download. So the store works offline, costs
nothing per search, and your clicks never leave your device.

Open the store, search for "wireless headphones", click a couple of products,
and watch the "Recommended for you" list re-sort toward your taste — instantly,
with no trip to a server. Then turn the server off and reload: it still works,
because everything it needs is already on your machine.

That's the whole pitch: **a real search-and-recommend engine that lives in the
browser instead of in a data center.** EdgeReco is the engine; Nimbus is the
demo store built on top of it.

> _Nimbus is a fictional store built only to demo EdgeReco. It is not a real
> shop. Its products come from a public Amazon dataset — see
> [Data & attribution](#data--attribution)._

## Try it (one command)

You need this repo and Docker. Nothing else.

```bash
cd frontend && docker compose up --build

# then open the store:
open http://localhost:5173
```

You'll see a quick loading screen (it's fetching the catalog and a small AI
model), then the storefront. Click a few products and the recommendations
re-rank live. Stop the containers and reload — it keeps working offline.

---

## Under the hood (for developers)

Everything below is the technical depth. Each piece of jargon is defined the
first time it shows up.

Most search/recommendation stacks are glued to a remote backend: every query
crosses the network, every recommendation rebuilds session state in some
service. EdgeReco inverts that. The catalog is distributed like static assets
through a CDN; the engine ships as a small library; inference happens locally —
in a browser tab, or in a Python process. Sync once, run anywhere.

### Architecture

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

- **origin** — serves a *signed, content-addressed bundle*: a `latest` version
  pointer plus immutable `manifest/<hash>` and `chunk/<hash>` objects.
  *Content-addressed* means each file is named by the hash of its bytes, so it
  can be cached forever and can't be tampered with undetectably. A committed
  728-product Amazon bundle lives in `backend/examples/catalog/`.
- **edge** — a Caddy reverse proxy (a small static web server / CDN) applying
  the bundle's cache policy: immutable chunks cached forever, short-TTL pointer.
- **browser tier** — the Nimbus single-page app (SPA) syncs the bundle into
  *OPFS* (Origin Private File System — the browser's per-site sandboxed disk),
  verifies it with Ed25519 signatures + SHA-256 checksums *fail-closed* (any
  mismatch aborts the load) against a key pinned in the SPA build, loads the
  `all-MiniLM-L6-v2` embedding model via transformers.js, and runs the full
  hybrid-search + session-aware rerank pipeline **in the tab**. No application
  backend in the request path.
- **edgereco runtime (Python)** — the same engine packaged as a FastAPI app for
  the server-side use case. Same scoring formula, same sync + verify, same
  prebuilt FAISS index — the in-browser engine (`@edgeproc/browser`) is
  parity-tested against it.

### How it works

**Hybrid search.** Two retrieval methods run in parallel and get merged.
*BM25* is a classic keyword-relevance score (catches exact matches). *FAISS*
(Facebook AI Similarity Search) does fast nearest-neighbour lookup over
embedding vectors (catches paraphrases — "earbuds" finds "wireless headphones").
The two rankings are fused with *RRF* (Reciprocal Rank Fusion):
`rrf_score = Σ 1/(k + rank_i)` summed over each backend's rank for an item.

**Session-aware reranking.** Click / view / favorite / cart events accumulate
per-session affinity for category, tag, and brand. The reranker rescores the
hybrid candidates:

```
score = 0.40·popularity + 0.20·category_aff + 0.15·tag_aff
      + 0.10·brand_aff + 0.10·freshness − 0.25·repetition
```

Recently-viewed items get penalized; matching categories / brands / tags get
amplified. It's all in-memory and per-tab, so reloading starts fresh.

**Catalog sync.** The origin publishes the signed, content-addressed bundle: a
`latest` version pointer (Ed25519-signed) → an immutable `manifest/<hash>` →
immutable `chunk/<hash>` objects. The consumer fetches `/latest`, verifies its
signature against the pinned public key (fail-closed on tampering), pulls only
the listed chunks, reassembles each bundled file — including the prebuilt FAISS
`vector/` index — into a local cache, and `VectorIndex.load`s it (zero
recompute). After sync, the runtime is fully offline-capable.

**In the browser.** The same pipeline — sync the signed bundle, verify it
Ed25519 + SHA-256, run BM25 ⊕ vector → RRF → session-rerank — runs in the tab
via the [`@edgeproc/browser`](frontend/packages/edgeproc-browser/README.md)
workspace package. The browser embedder is `Xenova/all-MiniLM-L6-v2` via
transformers.js, the byte-for-byte equivalent of the Python encoder, and the
top-k is parity-tested against the FastAPI runtime over the same bundle. See
[`frontend/README.md`](frontend/README.md) for the storefront over this engine.

### Quickstart — publish → sync → serve (Python API, no Docker)

For the **optional** server-side API variant (the FastAPI runtime, not used by
the headline browser demo above), reproduce the delivery loop with the bundle
CLI:

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

The committed `backend/examples/catalog/` is exactly such an origin (built from
the 728-product Amazon catalog), so step 4 alone — pointed at it — serves the
demo data.

### CLI

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

### Configuration

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

### Development

```bash
# Backend (Python recommender)
cd backend
uv sync --group dev
uv run poe gate                                  # lint + type-check + tests + coverage gate

# Frontend (Nimbus storefront + @edgeproc/browser)
cd ../frontend
pnpm install                      # resolves the whole pnpm workspace (app + package)
pnpm -r run lint                  # biome on both workspace members
pnpm -r run typecheck             # tsc -b on both
pnpm -r run test                  # vitest on both
pnpm -F frontend run build        # prove the workspace link resolves
```

The repo follows strict TDD/BDD: unit tests in `backend/tests/unit/`, BDD
scenarios in `backend/features/` with steps in `backend/tests/bdd/`, integration
tests in `backend/tests/integration/`, end-to-end in `backend/tests/e2e/`.

### Data & attribution

This demo ships **two different catalogs** — don't confuse them:

| Catalog | Path | What it is |
| --- | --- | --- |
| **Demo data (the headline)** | `backend/examples/catalog/` | A committed, signed 728-product bundle of **real Amazon products**. This is what the Nimbus storefront and the offline demo use. |
| Synthetic API fixture | `backend/demo_server/catalog/products.jsonl` | 300 **fabricated** products with made-up brands, used only by the optional FastAPI API server. Not real data. |

The committed 728-product bundle is derived from the **Amazon E-commerce
Products & Reviews Dataset** by *lazylad99* on
[Kaggle](https://www.kaggle.com/datasets/lazylad99/amazon-e-commerce-product-and-review-dataset),
published under the **MIT** license. It was produced via `edgereco build-catalog`
→ `edgereco index` → `edgereco bundle`; you can regenerate it from the raw CSVs
with the same commands (or `edgereco preprocess` for the Kaggle CSV schema).

The MIT license covers the uploader's *compilation* of the dataset; the
underlying product listings, review text, and images were scraped from
Amazon.com and remain subject to Amazon's terms. See the top-level
[`NOTICE`](NOTICE) for the full attribution and the rights caveat — and verify
your rights before redistributing the underlying content.

### Docs

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — current architecture, system context, request lifecycle (with d2 diagrams).
- [`docs/QUICKSTART.md`](docs/QUICKSTART.md) — clone → backend gate → frontend test → run the demo end-to-end.
- [`docs/DEPLOY.md`](docs/DEPLOY.md) — backend-free vs edge-origin deployment patterns.
- [`docs/diagrams/`](docs/diagrams/) — d2 sources + rendered SVGs.

### Repo layout

- `backend/` — Python project root (`pyproject.toml`, `uv.lock`).
  - `backend/src/edgereco/` — runtime: `catalog/` `embeddings/` `search/` `reco/` `edge/` `telemetry/` `api/` `cli.py` `config.py`
  - `backend/features/` — Gherkin BDD specs, decoupled from step implementations
  - `backend/tests/` — `unit/` `bdd/` `integration/` `e2e/`
  - `backend/deploy/` — `Dockerfile`, `docker-compose.yml`, Caddy edge config
  - `backend/examples/catalog/` — committed signed 728-product Amazon catalog bundle (`latest` + `manifest/` + `chunk/`)
  - `backend/examples/keys/public.key` — pinned Ed25519 verify key for the bundle
  - `backend/demo_server/` — optional FastAPI API-server launcher (not in main gate); ships the 300-product synthetic fixture
  - `backend/scripts/` — fixture generators for browser-tier parity tests
- `frontend/` — pnpm workspace root (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`).
  - `frontend/app/` — Nimbus React storefront (backend-free; syncs + runs the engine in-browser)
  - `frontend/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser sync + hybrid-search engine
- `docs/` — `ARCHITECTURE.md` · `QUICKSTART.md` · `DEPLOY.md` · `diagrams/` · `archive/`

## License

[Apache-2.0](LICENSE). Third-party data attribution is in [`NOTICE`](NOTICE).
