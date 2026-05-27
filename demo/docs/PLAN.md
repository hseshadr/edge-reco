# Nimbus Storefront Demo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A beautiful React storefront ("Nimbus") that runs edge-reco's search + session-aware recommendations, making the click → re-rank personalization loop visible.

**Architecture:** `demo/backend/` is a thin FastAPI wrapper that loads a committed catalog via edge-reco's `ServiceContainer.from_catalog`, mounts the existing `create_app`, and adds CORS. `demo/frontend/` is a React + Vite + TypeScript SPA talking to it over HTTP, persisting an `X-Session-Id`. A D2 diagram documents the system.

**Tech Stack:** Python 3.13 / FastAPI / uvicorn (backend); React + Vite + TypeScript + Biome (frontend); Playwright + Vitest (frontend tests); pytest (backend tests); D2 (diagram); Docker Compose (run).

**Engine contract (verify against code at execution; from `src/edgereco/api/`):**
- `ServiceContainer.from_catalog(products: list[Product]) -> ServiceContainer` (`api/deps.py`)
- `create_app(container) -> FastAPI` (`api/app.py:10`) — adds NO CORS.
- `GET /healthz` → `{"status":"ok"}`
- `GET /search?q=&limit=10&category=` → `{results:[{product, score, score_components?}], query, total}` (search results have NO `score_components`)
- `GET /recommend?limit=10` (header `X-Session-Id`) → `{results:[{product, score, score_components}], session_clicks}`
- `POST /events` body `{events:[{event_type:"click|view|favorite|cart", product_id, timestamp, metadata?}]}` → `{received:int}`
- `GET /catalog/info` → `{catalog_id, version, product_count, index_stats}`
- `Product`: `{id, title, description, category, subcategories[], tags[], brand, price?, currency, popularity_score, freshness_score, image_url, url, attributes{}}`
- `score_components`: `{popularity, category_match, tag_match, brand_match, freshness, repetition_penalty}`

---

## Task 1: Scaffold + committed stand-in catalog

**Files:**
- Create: `demo/backend/__init__.py`, `demo/backend/catalog/.gitkeep`, `demo/backend/data/raw/.gitkeep`
- Create: `demo/.gitignore` (ignore `data/raw/*` except `.gitkeep`, `frontend/node_modules`, `frontend/dist`, `__pycache__`)
- Create: `demo/backend/catalog/products.jsonl` (stand-in)

- [ ] **Step 1:** Provide a committed stand-in catalog at `demo/backend/catalog/products.jsonl` (the offline fallback for plain `uv run` / tests). The live demo no longer reads this file — when `EDGERECO_BUNDLE_BASE_URL` + `EDGERECO_VERIFY_KEY_PATH` are set, the backend syncs the real signed bundle from `examples/catalog/` via the Caddy edge (`ServiceContainer.from_synced`). To regenerate the stand-in from the real bundle, materialize it with the bundle CLI rather than the (removed) flat `products.jsonl`:
```bash
# verify-and-extract the committed bundle, then take a manageable subset
EDGERECO_BUNDLE_BASE_URL=examples/catalog \
EDGERECO_VERIFY_KEY_PATH=examples/keys/public.key \
EDGERECO_BUNDLE_CACHE_DIR=/tmp/standin \
    uv run edgereco serve /tmp/standin /tmp/standin --port 0  # syncs -> /tmp/standin/materialized
head -n 300 /tmp/standin/materialized/products.jsonl > demo/backend/catalog/products.jsonl
```

- [ ] **Step 2:** Write `demo/.gitignore`:
```gitignore
__pycache__/
*.pyc
frontend/node_modules/
frontend/dist/
backend/data/raw/*
!backend/data/raw/.gitkeep
.env
```

- [ ] **Step 3:** Commit. `git add demo && git commit -m "feat(demo): scaffold + stand-in catalog"`

## Task 2: Backend wrapper (CORS + serve) — TDD

**Files:**
- Create: `demo/backend/main.py`
- Test: `demo/backend/tests/test_demo_api.py`

- [ ] **Step 1: Failing test** (`demo/backend/tests/test_demo_api.py`):
```python
from __future__ import annotations

from fastapi.testclient import TestClient

from demo.backend.main import app

client = TestClient(app)


def test_healthz_ok() -> None:
    r = client.get("/healthz")
    assert r.status_code == 200


def test_cors_header_present_for_browser_origin() -> None:
    r = client.get("/healthz", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"


def test_search_then_click_then_recommend_personalizes() -> None:
    sid = {"X-Session-Id": "demo-test-1"}
    hits = client.get("/search", params={"q": "headphones", "limit": 5}).json()["results"]
    assert hits
    pid = hits[0]["product"]["id"]
    client.post("/events", json={"events": [{"event_type": "click", "product_id": pid,
                "timestamp": "2026-05-26T00:00:00Z"}]}, headers=sid)
    rec = client.get("/recommend", params={"limit": 10}, headers=sid).json()
    assert rec["session_clicks"] >= 1
    assert rec["results"][0]["score_components"] is not None
```

- [ ] **Step 2: Run, expect fail** (`demo.backend.main` missing). Run: `cd /Users/harish/dev/oss/edge-reco && uv run python -m pytest demo/backend/tests/test_demo_api.py -o "addopts=" -q`

- [ ] **Step 3: Implement** `demo/backend/main.py` (verify `create_app`/`ServiceContainer` signatures against `src/edgereco/api/` first):
```python
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from edgereco.api.app import create_app
from edgereco.api.deps import ServiceContainer
from edgereco.catalog.models import Product

_CATALOG = Path(__file__).parent / "catalog" / "products.jsonl"
_ALLOWED_ORIGINS = ("http://localhost:5173", "http://localhost:4173")


def _load_products() -> list[Product]:
    with _CATALOG.open(encoding="utf-8") as handle:
        return [Product.model_validate_json(line) for line in handle if line.strip()]


def build_app() -> FastAPI:
    app = create_app(ServiceContainer.from_catalog(_load_products()))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(_ALLOWED_ORIGINS),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    return app


app = build_app()
```

- [ ] **Step 4: Run, expect pass.** Same command as Step 2.

- [ ] **Step 5: Commit.** `git add demo/backend && git commit -m "feat(demo): FastAPI wrapper with CORS over edge-reco engine"`

## Task 3: Frontend scaffold + typed API client

**Files:**
- Create: `demo/frontend/` (Vite React-TS), `demo/frontend/src/api/client.ts`, `demo/frontend/src/api/types.ts`, `demo/frontend/src/session.ts`
- Config: Biome, `.env` with `VITE_API_BASE=http://localhost:8000`

- [ ] **Step 1:** Scaffold: `cd demo/frontend && npm create vite@latest . -- --template react-ts && npm install`. Add Biome: `npm i -D @biomejs/biome && npx biome init`.
- [ ] **Step 2:** `src/api/types.ts` — TS interfaces mirroring the engine contract (`Product`, `ScoreComponents`, `SearchResult`, `SearchResponse`, `RecommendResponse`, `InteractionEvent`). No `any`.
- [ ] **Step 3:** `src/session.ts` — get-or-create a session id in `localStorage` (`nimbus_session_id`).
- [ ] **Step 4:** `src/api/client.ts` — typed `search(q, opts)`, `recommend(limit)`, `sendEvent(evt)`, `catalogInfo()`; every request sends `X-Session-Id`. Base URL from `import.meta.env.VITE_API_BASE`.
- [ ] **Step 5:** Vitest unit for the session helper (get-or-create stable id) + a client test with a mocked `fetch`. Run `npx vitest run`.
- [ ] **Step 6:** Commit. `git add demo/frontend && git commit -m "feat(demo): frontend scaffold + typed API client"`

## Task 4: Storefront UI (frontend-design skill)

**Files:** `demo/frontend/src/components/*`, `demo/frontend/src/App.tsx`, styles.

> Built with the `frontend-design` skill for distinctive, production-grade aesthetics. Gate with `frontend-quality` (Biome, `tsc --noEmit`, no `any`, no default exports, a11y baseline).

- [ ] **Step 1:** Header — Nimbus brand, search box (debounced → `/search`), category nav chips.
- [ ] **Step 2:** Product grid — responsive cards with image (gradient fallback on `onError`), title, brand, price; click handler fires `sendEvent({event_type:"click", product_id})` then triggers a recommend refresh.
- [ ] **Step 3:** "Recommended for you" rail — fetches `/recommend`, re-renders on every interaction so re-ranking is visible; empty/cold state messaging.
- [ ] **Step 4:** "Why recommended?" popover on rail cards — renders `score_components` as labeled bars.
- [ ] **Step 5:** App state wiring — session id, current results, recommend list; loading/error states (no silent failures).
- [ ] **Step 6:** Run quality gate (frontend-quality) + `tsc --noEmit` + Biome; fix. Commit.

## Task 5: Real Amazon catalog (staged — when dataset provided)

**Files:** `demo/backend/scripts/build_catalog.py`

- [ ] **Step 1:** Inspect the user-provided raw file in `demo/backend/data/raw/` (columns/format).
- [ ] **Step 2:** Write `build_catalog.py` mapping raw rows → `Product` (id, title, description, category, tags, brand, price, **image_url**, url; derive `popularity_score`/`freshness_score` if absent). Write `demo/backend/catalog/products.jsonl`.
- [ ] **Step 3:** Run it; sanity-check counts + that `image_url` is populated. Commit the regenerated `products.jsonl`.
- [ ] **Step 4:** Re-run Task 2 backend tests + visual check that images render.

## Task 6: D2 architecture diagram

**Files:** `demo/docs/architecture.d2`, rendered `demo/docs/architecture.svg`

- [ ] **Step 1:** Write `architecture.d2`: Browser (React storefront) →[HTTP + CORS]→ FastAPI (demo/backend) → edge-reco engine {search: BM25 + FAISS-vector (EdgeProc) → RRF fusion; recommend: scorer + session-aware reranker over SessionProfile} → EdgeProc substrate {FaissVectorIndex, RRF, BM25, TextEncoder} → shared-libs-python contracts. Highlight the `events → SessionStore → recommend` loop.
- [ ] **Step 2:** Render: `d2 demo/docs/architecture.d2 demo/docs/architecture.svg` (if `d2` not installed, document the one-line install + commit the `.d2` source regardless).
- [ ] **Step 3:** Commit.

## Task 7: Playwright e2e + README + run

**Files:** `demo/frontend/tests/e2e/storefront.spec.ts`, `demo/frontend/playwright.config.ts`, `demo/README.md`, `demo/docker-compose.yml`, `demo/backend/Dockerfile`, `demo/frontend/Dockerfile`

- [ ] **Step 1:** Playwright config + e2e: start backend + frontend, load store, search, click 2-3 products in a category, assert the recommend rail re-orders (a product from the clicked category rises) and the "why" popover renders. Run `npx playwright test`.
- [ ] **Step 2:** `docker-compose.yml` (backend uvicorn + frontend served) + Dockerfiles; verify `docker compose up` serves the store.
- [ ] **Step 3:** `demo/README.md` — TL;DR, the architecture.svg + explanation, one-command run, the realistic click→re-rank flow, a screenshot.
- [ ] **Step 4:** Commit.

## Self-review notes
- Spec coverage: backend+CORS (T2), frontend+client (T3), storefront UI incl. why-overlay (T4), real Amazon data/images (T5), D2 diagram (T6), both-sides tests + run + README (T7). All covered.
- Staging: T1–T4 + T6–T7 run on the stand-in catalog so the demo is end-to-end runnable before the Kaggle file lands; T5 swaps in real data + images without touching UI code (same `Product` schema).
