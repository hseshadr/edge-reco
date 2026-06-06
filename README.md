# EdgeReco

> **Sync once. Run anywhere. Zero backend calls.**

[![CI](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml/badge.svg)](https://github.com/hseshadr/edge-reco/actions/workflows/ci.yml)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python 3.13+](https://img.shields.io/badge/python-3.13+-blue.svg)](https://www.python.org/downloads/)

**Nimbus is a pretend online store.** The interesting part: its entire
search-and-recommend brain runs *inside your browser tab* — no server, no
backend calls — after a one-time download. So the store works offline, costs
nothing per search, and your clicks never leave your device.

Open the store, search for "wireless headphones", then click a couple of
products. Every click reshapes the "Recommended for you" rail across five taste
signals — category, brand, tags, popularity, and freshness — re-ranking
**instantly, on-device, with no trip to a server.** This is the same shape of
per-session personalization big storefronts run server-side; here it runs
entirely in your tab, so your clicks never leave your device. Turn the server
off and reload: it still works, because everything it needs is already on your
machine.

That's the whole pitch: **a real, heavily personalized search-and-recommend
engine that lives in the browser instead of in a data center.** EdgeReco is the
engine; Nimbus is the demo store built on top of it.

> _Nimbus is a fictional store built only to demo EdgeReco. It is not a real
> shop. Its products come from a public Amazon dataset — see
> [Data & attribution](#data--attribution)._

## Try it (one command)

You need this repo and Docker. Nothing else.

```bash
cd frontend && docker compose up --build

# then open the store:
open http://localhost:5174
```

You'll see a quick loading screen (it's fetching the catalog and a small AI
model), then the storefront. Click a few products and the recommendations
re-rank live. Stop the containers and reload — it keeps working offline.

**Working on the code?** With the toolchain installed (uv + Node + pnpm + Docker),
`poe demo` (or `make demo`) from the repo root does the same thing in one command
and opens the browser for you — signed-bundle edge on `:8081`, the Vite SPA on
`:5174`. (`cd backend && uv run poe demo` works too, e.g. without a global poe
install; `make demo` falls back to it automatically.)

**See the flywheel:** `poe demo-flywheel` adds a "mimicked cloud" collector on
`:8081`→`:8000` and shows the uplink half of the loop — clicks are captured in-tab
and periodically flushed (batched, fire-and-forget) to the FastAPI `/events`
endpoint, so the cloud can retrain. Inference still runs 100% locally; the
uplink is optional and off by default (the plain `poe demo` makes zero backend
calls). Watch the `POST /events` requests and the "N interactions synced to cloud"
badge.

**Close the loop:** after clicking around, `poe demo-retrain` is the cloud half —
it aggregates the collected events, recomputes each product's popularity, and
**republishes a freshly signed bundle**. Refresh the SPA and the rail re-ranks
toward what you clicked, because both tiers re-sync the new popularity from the
same signed bundle — *no scoring-formula change, no re-embedding*. That's the
whole flywheel: click → cloud → retrain → better rail. (Re-signing needs the
maintainer's private key, `examples/keys/private.key`, so this step is for repo
owners; the published demo ships the result.)

---

## Under the hood (for developers)

Everything below is the technical depth. Each piece of jargon is defined the
first time it shows up.

Most search/recommendation stacks are glued to a remote backend: every query
crosses the network, every recommendation rebuilds session state in some
service. EdgeReco inverts that. The catalog is distributed like static assets
through a CDN; the engine ships as a small library; inference happens locally —
in a browser tab, or in a Python process. Sync once, run anywhere.

### Built on edge-proc

EdgeReco is two layers, not one. The bottom layer is **edge-proc** — a generic
local-compute substrate: signed, content-addressed bundle sync, an OPFS/CAS
(content-addressed store) cache, Ed25519 + SHA-256 fail-closed verification, and
the hybrid-retrieval primitives (BM25 ⊕ vector → RRF) with FAISS /
transformers.js embedders. The top layer is **edge-reco** — the
product-discovery brain: the scoring formula, the session-signal capture, and
the session-aware reranker.

That dependency is real in both runtimes. The Python side pulls
[`edge-proc[localvec,bundles]`](backend/pyproject.toml#L20); the browser side
runs [`@edgeproc/browser`](frontend/packages/edgeproc-browser/) — _the edge-proc
browser tier_ — over the same signed bundle. The substrate is reusable for any
local search workload; edge-reco is what turns it into recommendations, and the
two tiers are parity-tested against each other.

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
  720-product Amazon bundle lives in `backend/examples/catalog/`.
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

**Session-aware reranking.** This is the personalization layer, and it's not a
toy. Every interaction bumps per-session affinity for the product's category,
tags, and brand by a weight that scales with intent:

| event | category | tag | brand |
|---|---|---|---|
| view | +0.02 | +0.01 | +0.02 |
| click | +0.10 | +0.05 | +0.08 |
| favorite | +0.20 | +0.10 | +0.15 |
| cart | +0.25 | +0.12 | +0.20 |

Affinities clamp at 1.0; the last 50 viewed product IDs carry a repetition
penalty so the rail keeps surfacing new things. The reranker rescores the hybrid
candidates against that live profile:

```
score = 0.40·popularity + 0.20·category_aff + 0.15·tag_aff
      + 0.10·brand_aff + 0.10·freshness − 0.25·repetition
```

The loop is **zero-network**: a click folds straight into the in-memory session
profile and the rail re-ranks on the spot — no fetch, no round trip. And it's
not a black box — each result carries a "Why?" breakdown showing exactly which
signal moved it (popularity vs. category vs. tag vs. brand vs. freshness, minus
any repetition penalty). It's all in-memory and per-tab, so reloading starts
fresh.

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
    --catalog-id amazon-demo --version v1 --product-count 720

# 4. serve by syncing that origin (filesystem URL works too) + verifying the key
EDGERECO_BUNDLE_BASE_URL=/tmp/origin \
EDGERECO_VERIFY_KEY_PATH=examples/keys/public.key \
EDGERECO_BUNDLE_CACHE_DIR=/tmp/bundle-cache \
    uv run edgereco serve /tmp/staging /tmp/staging --port 8000
```

The committed `backend/examples/catalog/` is exactly such an origin (built from
the 720-product Amazon catalog), so step 4 alone — pointed at it — serves the
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
| **Demo data (the headline)** | `backend/examples/catalog/` | A committed, signed 720-product bundle of **real Amazon products**, balanced across **12 categories** (60 each) so session-aware reranking visibly personalizes. This is what the Nimbus storefront and the offline demo use. |
| Synthetic API fixture | `backend/demo_server/catalog/products.jsonl` | 300 **fabricated** products with made-up brands, used only by the optional FastAPI API server. Not real data. |

The committed 720-product bundle is a balanced, curated subset of the
**Amazon Reviews 2023** dataset (item metadata) by the McAuley Lab at UC San Diego
([amazon-reviews-2023.github.io](https://amazon-reviews-2023.github.io/), released
for research use; cite Hou et al., *arXiv:2403.03952*). It is produced by
`scripts/curate_demo_catalog.py` (a balanced 12-category subset →
`examples/source/catalog.csv`) → `edgereco build-catalog` → `edgereco index` →
`edgereco bundle`; you can regenerate it with the same commands.

This attribution is *not* a license to the underlying content: the product
listings, titles, and images originate from Amazon.com and remain subject to
Amazon's terms. See the top-level [`NOTICE`](NOTICE) for the full attribution and
the rights caveat — and verify your rights before redistributing the underlying
content.

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
  - `backend/examples/catalog/` — committed signed 720-product Amazon catalog bundle (`latest` + `manifest/` + `chunk/`)
  - `backend/examples/source/catalog.csv` — committed, reproducible build source for the bundle (12 balanced categories)
  - `backend/examples/keys/public.key` — pinned Ed25519 verify key for the bundle
  - `backend/demo_server/` — optional FastAPI API-server launcher (not in main gate); ships the 300-product synthetic fixture
  - `backend/scripts/` — `curate_demo_catalog.py` (builds `examples/source/catalog.csv`) + browser-tier parity-fixture generators
- `frontend/` — pnpm workspace root (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`).
  - `frontend/app/` — Nimbus React storefront (backend-free; syncs + runs the engine in-browser)
  - `frontend/packages/edgeproc-browser/` — `@edgeproc/browser`, the in-browser sync + hybrid-search engine
- `docs/` — `ARCHITECTURE.md` · `QUICKSTART.md` · `DEPLOY.md` · `diagrams/` · `archive/`

## License

[Apache-2.0](LICENSE). Third-party data attribution is in [`NOTICE`](NOTICE).
