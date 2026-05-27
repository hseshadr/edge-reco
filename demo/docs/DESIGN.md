# Nimbus storefront demo — design

## Context

`edge-reco` is a hybrid-search + session-aware recommendation engine with a working
FastAPI backend (`/search`, `/recommend`, `/events`, `/catalog/info`) but **no UI**. The
recommendation power is invisible without a storefront. This demo is the selling point:
a beautiful React storefront for a dummy marketplace (**Nimbus**) that makes the
**click → personalize → re-rank** loop *visible*. Approved decisions: lives in
`edge-reco/demo/` as `backend/` + `frontend/`; general marketplace; real Amazon product
data with image URLs (manually downloaded from Kaggle by the user); plus a D2
architecture diagram.

## Hero interaction

Not search — the **live personalization loop**. The shopper browses/clicks products;
each click fires `POST /events` (with a persisted `X-Session-Id`), then the "Recommended
for you" rail refetches `/recommend` and visibly re-ranks toward the shopper's taste. A
"why?" popover surfaces `score_components` (popularity, category/tag/brand affinity,
freshness, repetition penalty) — the engine explaining itself. This loop is already wired
server-side; the UI exposes it.

## Structure (`edge-reco/demo/`)

```
demo/
  backend/
    main.py                  ServiceContainer.from_catalog(products) → create_app → CORSMiddleware → uvicorn
    catalog/products.jsonl   committed catalog (stand-in first, real Amazon subset after)
    data/raw/                .gitignored — where the raw Kaggle dataset is dropped
    scripts/build_catalog.py one-time: raw dataset → edge-reco Product schema (id, title, category, brand, price, description, image_url, url)
    tests/test_demo_api.py   CORS headers present; catalog loads; search→click→recommend loop responds
  frontend/                  React + Vite + TypeScript storefront (frontend-design skill; frontend-quality gate)
  docs/
    DESIGN.md                this file
    architecture.d2          + rendered architecture.svg
  README.md                  one-command run + architecture explanation
```

## Backend (thin — no engine changes)

Reuse edge-reco's engine. `demo/backend/main.py`: load the committed `products.jsonl` →
`ServiceContainer.from_catalog(products)` → existing `create_app(container)` → add
`CORSMiddleware` (the one missing piece for a browser SPA) → uvicorn. Catalog source is
swappable: a stand-in (edge-reco's synthetic products) until the real Amazon subset lands.

## Frontend (React + Vite + TypeScript)

Built via the `frontend-design` skill, gated by `frontend-quality` (Biome, `tsc`, no `any`,
no default exports). Components: header with search + category nav; responsive product grid
(real images, gradient fallback on error); **"Recommended for you" rail** that re-ranks live
on interaction; product card click → `POST /events` → refetch `/recommend`; "why
recommended?" popover from `score_components`. Session id generated once and persisted in
`localStorage`, sent as `X-Session-Id` on every request. A thin typed API client wraps the
four endpoints.

## Data / images

Real Amazon product subset (Kaggle, user-downloaded). `build_catalog.py` maps the raw
columns → `Product` (filling `image_url`/`url`), writes `catalog/products.jsonl`, which is
**committed** so the demo is reproducible without Kaggle/network at runtime. Images hotlink
from the dataset's CDN URLs at view time; a gradient tile renders on load error. A
stand-in catalog (edge-reco's existing synthetic 1000 products) is used until the real file
is provided, so the build is never blocked.

## Architecture diagram (D2)

`docs/architecture.d2` → rendered SVG. Shows: Browser (React) →[HTTP + CORS]→ FastAPI
(demo/backend) → edge-reco engine — search path (BM25 keyword + FAISS vector via EdgeProc →
RRF fusion) and recommend path (scorer + session-aware reranker over `SessionProfile`) →
EdgeProc substrate (FaissVectorIndex, RRF, BM25, TextEncoder) → shared-libs-python contracts.
The `events → SessionStore → recommend` personalization loop is highlighted. Explained in
the README.

## Testing (both sides)

- **Backend** (pytest): CORS headers present on responses; catalog loads; the
  search → click(`/events`) → `/recommend` loop returns and re-ranks.
- **Frontend** (Playwright e2e + Vitest units): load store → search → click products →
  assert the recommend rail re-orders and the "why" popover renders; component units.

## Run (clone → working output)

One command via `docker compose up` (frontend + backend), or a dev path (`uv run` backend +
`npm run dev` frontend). README shows the realistic flow with a screenshot.

## Build order

1. Scaffold `demo/` + backend wrapper (CORS, stand-in catalog) — runnable API.
2. Frontend storefront against the live backend.
3. `build_catalog.py` + swap in the real Amazon catalog/images when the file is provided.
4. D2 diagram + README.
5. Tests both sides; quality gates green.
