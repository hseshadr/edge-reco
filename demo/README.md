# Nimbus storefront demo

**TL;DR.** Nimbus is a storefront for a fictional "everything store" that runs
[edge-reco](../)'s hybrid search and session-aware recommendations as its brain. The
point isn't the catalog — it's the **live personalization loop**: click a few products
and the "Recommended for you" rail visibly re-ranks toward your taste, while a **"why?"**
panel opens up the engine and shows the score components (popularity, category/tag/brand
affinity, freshness, repetition penalty) behind each pick. It turns edge-reco's invisible
recommendation power into something you can watch happen.

## Architecture

![Architecture](docs/architecture.svg)

The flow, end to end:

1. **Browser (React SPA)** renders the store and talks to the backend over **HTTP + CORS**,
   tagging every request with a persisted `X-Session-Id` header.
2. The **FastAPI wrapper** (`demo/backend/`) is thin: it wraps edge-reco's `create_app`,
   adds CORS, and mounts a `/products` browse feed. No engine changes.
3. The **edge-reco engine** does the work. *Search:* BM25 keyword scores ⊕ FAISS vector
   scores → **RRF fusion** into one ranked list. *Recommend:* a scorer plus a
   **session-aware reranker** over a per-session profile built from your clicks.
4. Both paths sit on the **EdgeProc substrate** (FaissVectorIndex, RRF, BM25, TextEncoder),
   which is typed against **shared-libs-python** contracts.
5. **The loop that matters:** a product click fires `POST /events` → the engine updates that
   session's profile → the next `GET /recommend` re-ranks. Click → `/events` → re-rank.

## Screenshot

![Nimbus storefront](docs/storefront.png)

*The "Recommended for you" rail (right) re-ranks live as you click; the session badge counts
the signals captured this session. (Produced by the Playwright e2e run — see `make test`.)*

## Quickstart

**Primary path — one command** (starts backend + frontend together):

```bash
cd demo
make install   # one-time: backend (uv) + frontend (npm) deps
make dev        # starts the FastAPI backend + Vite frontend
```

Then open **http://localhost:5173**.

**Manual path — two terminals**, if you'd rather run the halves yourself:

```bash
# Terminal 1 — backend (run from the repo root, NOT from demo/)
cd /path/to/edge-reco
uv run python -m demo.backend.serve
```

> **Use this launcher, not `uvicorn` directly.** edge-reco builds its in-memory index at
> startup with `asyncio.run(...)`. uvicorn's import-string mode imports the app *inside* its
> own running event loop, and `asyncio.run` crashes when a loop is already running. The
> `serve` launcher builds the app at import time (before any loop exists) and hands the
> ready object to uvicorn, sidestepping the crash.

```bash
# Terminal 2 — frontend
cd demo/frontend
npm run dev
```

**Tests** (both sides, plus the browser e2e that captures the screenshot):

```bash
cd demo
make test   # backend pytest + frontend Vitest units + Playwright e2e
```

## Demo flow (the realistic one)

1. **Open the store** at http://localhost:5173. The grid shows the catalog; the
   "Recommended for you" rail starts in a cold state (no signals yet).
2. **Search** for something — e.g. `wireless headphones`. The grid swaps to fused
   BM25 + vector results for your query.
3. **Click 2–3 products in one category** (say, audio gear). Each click fires
   `POST /events` and a toast confirms it was added to your taste.
4. **Watch the rail re-rank** toward that category after each click, and the **session
   badge** increment as signals accumulate.
5. **Open "why?"** on a recommended card to see the **score bars** — popularity,
   category/tag/brand match, freshness, and the repetition penalty — i.e. the engine
   explaining why it surfaced that product for *you*.

Sessions are **per-browser** (the `X-Session-Id` lives in `localStorage`) and held
**in-memory server-side**, so they reset when the backend restarts. Open a fresh
incognito window to start from a clean slate.

## Architecture notes

- **`demo/backend/`** is a thin FastAPI wrapper around edge-reco. It loads the committed
  catalog, builds the engine's `ServiceContainer`, mounts the library's `create_app`, adds
  `CORSMiddleware` (the one piece a browser SPA needs), and adds a read-only `/products`
  browse endpoint over the same catalog. No engine code is changed.
- **`demo/frontend/`** is React + Vite + TypeScript — Biome (lint/format), Vitest (units),
  Playwright (e2e), Motion (animation). A thin typed client wraps the four engine endpoints
  plus `/products`.
- **The catalog is a committed stand-in** today: edge-reco's synthetic products, rendered
  with gradient image tiles (no network needed to run the demo). Real Amazon product data
  and images drop in later via `demo/backend/scripts/build_catalog.py` (roadmap) — it maps
  the raw dataset to the same `Product` schema and rewrites `catalog/products.jsonl`, so
  **the UI doesn't change at all**.

## Config

| Var | Side | Default | Purpose |
| --- | --- | --- | --- |
| `VITE_API_BASE` | frontend | `http://localhost:8000` | Backend base URL the SPA calls. |
| `DEMO_HOST` | backend | `127.0.0.1` | Host the launcher binds. |
| `DEMO_PORT` | backend | `8000` | Port the launcher binds. |
| `DEMO_CORS_ORIGINS` | backend | localhost `:5173`/`:4173` | Comma-separated allowed origins; override for non-localhost / LAN / Docker serving. |

## What this shows about edge-reco

That the same engine does keyword + semantic search *and* turns a stream of clicks into
personalized, self-explaining recommendations in real time — with the storefront as a thin
client over a stable, typed API.
