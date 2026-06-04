# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **Flywheel uplink (the "events back to the cloud" loop)** — clicks are now
  captured in-tab, persisted (localStorage), and periodically flushed in batches
  to a "mimicked cloud" collector (the existing FastAPI `/events`). It is an
  **optional, async, fire-and-forget beacon kept entirely off the inference
  path** and **off by default**: with `VITE_EVENTS_URL` unset the demo makes zero
  backend calls (the headline invariant holds). New `poe demo-flywheel` brings up
  the collector container and runs the SPA with the uplink enabled; a `SyncBadge`
  shows "N interactions synced to cloud". Implemented in
  `frontend/app/src/telemetry/uplink.ts` (bounded queue, `fetch(keepalive)` +
  `navigator.sendBeacon` on unload), wired into `sendEvent` without touching the
  in-tab rerank. The collector's `/events` gained an optional in-body `session_id`
  so beacon batches (which can't set headers) attribute correctly.
  _Retrain half (aggregate events → recompute popularity → republish the signed
  bundle) is intentionally future work._

## [0.5.1] — 2026-06-03

Make the turnkey `poe demo` robust against a cross-project Docker collision that
surfaced as a cryptic **"signature verification failed"** in the browser. The
engine, signed bundle, pinned key, and fail-closed verify were all correct — the
failure was purely in demo orchestration when another project occupied `:8081`.

### Fixed
- **Isolated the demo's Docker namespace** — `frontend/docker-compose.yml` now pins
  `name: nimbus-demo`, so its volumes/network are `nimbus-demo_*` instead of the
  directory-derived default `frontend`. A sibling repo with its own `frontend/`
  compose dir no longer shares (and contaminates) the same `caddy_data` volume.
  This was the root cause: a foreign-but-valid signed `/latest` answered on `:8081`
  and failed the SPA's pinned-key verify.
- **`poe demo` now fails clearly, early** — the task runs `docker compose up -d
  --wait` (no startup race) and a preflight (`frontend/app/scripts/check-edge.mjs`)
  that asserts `:8081/latest` matches this repo's committed bundle pointer before
  opening the SPA. If another project occupies `:8081`, the user gets an actionable
  terminal message instead of a browser crypto error.

### Added
- **Preflight regression test** — `frontend/app/scripts/check-edge.test.mjs`
  (`pnpm test:preflight`, zero-dep `node:test`) covers the match / foreign-bundle /
  unreachable / non-200 / malformed-pointer branches; wired into CI.

## [0.5.0] — 2026-06-01

The session-aware reranker now *shows*: clicking products visibly re-ranks the
"Recommended for you" rail, backed by a balanced multi-category demo catalog.

### Added
- **Streaming demo-catalog curator** — `backend/scripts/curate_demo_catalog.py`
  builds a balanced, reproducible catalog source (`backend/examples/source/catalog.csv`)
  by streaming a real Amazon metadata parquet (memory-bounded; never loads the
  source's embeddings column). Pass `--source <parquet>`.

### Changed
- **Affinity-first recommendation rail** — clicking products now *visibly* re-ranks
  "Recommended for you". `recommend()` selects its candidate pool by session affinity
  when warm (popularity backfills only when there are fewer than `limit` matches);
  cold start stays popularity top-N. The scoring formula is unchanged — only candidate
  *selection* changed. Implemented byte-parity in the Python core (`reco/pool.py`) and
  the in-browser engine (`poolSelection.ts`).
- **Demo catalog rebuilt to 720 products across 12 balanced categories** (60 each), so
  session-aware reranking has real signal to act on (the previous bundle was ~98% one
  category). The committed signed bundle is re-signed with the existing pinned key, so
  fail-closed verification is unaffected.

### Fixed
- The "Recommended for you" rail no longer appears frozen on click — a data + candidate-
  pool problem, not a wiring bug (the click → profile → rerank loop was always correct).

### Docs
- Re-attributed the demo catalog to the **Amazon Reviews 2023** dataset (McAuley Lab,
  UC San Diego) in `NOTICE` and the README, with the underlying-content rights caveat.

## [0.4.1] — 2026-05-31

Developer-experience polish: a one-command, browser-opening demo runner.

### Added
- **Turnkey `poe demo` task** — `cd backend && uv run poe demo` brings up the
  signed-bundle Caddy edge (`:8081`), starts the Vite SPA (`:5173`), and opens the
  storefront in your browser: one command from clone to running in-tab. Surfaced in
  the README "Try it" section, `docs/ARCHITECTURE.md`, and `docs/QUICKSTART.md`.

## [0.4.0] — 2026-05-30

Public-launch readiness: legal attribution for the demo dataset, a clear
fictional-product disclaimer, a two-altitude README, and a reusable sync-tier
export — so a cold visitor sees an honest, runnable, properly-credited demo.

### Added
- **`@edgeproc/browser/engine`** — new stable public subpath export promoting the
  domain-agnostic sync tier (`EngineClient`, OPFS/memory CAS stores, the
  `syncIndex` state machine, crypto + wire types) to a first-class API. Previously
  reachable only behind the `./testing` seam marked "NOT production surface"; now
  a reusable sync tier for downstream consumers of the edgeproc pattern. Purely
  additive — the `.` (search) and `./testing` surfaces are untouched.
- **`NOTICE`** crediting the demo catalog's source: the Kaggle "Amazon
  E-commerce Products & Reviews Dataset" (MIT), with an Amazon Terms-of-Service
  caveat for the underlying product data.
- **Fictional-demo footer** in the storefront UI making explicit that "Nimbus"
  is a fictional store and the catalog is third-party sample data — plus
  browser/backend parity and config comments clarifying the shared search knobs.

### Changed
- **Two-altitude README**: a plain-language front door (what it is, how to run
  it) above an "under the hood" section for engineers, heroing the in-browser
  personalization story and surfacing the `edge-proc` dependency.
- **Offline-resilient `syncIndex`**: when the signed index can't be fetched, the
  browser tier now falls back to the cached active version instead of failing.

### Fixed
- **License consistency**: project unified on **Apache-2.0** (the README badge
  previously contradicted the declared license); data attribution corrected.
- npm→pnpm drift in the docs; e2e storefront screenshots redirected to a
  gitignored `test-results/` path.

## [0.3.0] — 2026-05-29

Northstar hardening: full test pyramid wired into CI, modern dependencies, and a
discoverable config surface — so the repo is not just clear but provably works
end-to-end on a cold clone.

### Added
- **Playwright e2e in CI** (`.github/workflows/frontend.yml`): the storefront
  suite and the C1 sync suite now run on every push/PR, with HuggingFace model
  weights cached and traces uploaded on failure.
- **In-browser model-load smoke test** (`frontend/app/tests/e2e-c1/embed.spec.ts`
  + `embed-harness.html`): loads the real MiniLM model through onnxruntime-web
  WASM in headless Chromium and asserts a normalized 384-d embedding — guarding
  the browser ML path that unit tests (Node backend) can't cover.
- **`.env.example`** for both `backend/` and `frontend/`, documenting every env
  var the code reads, referenced from a new README "Configuration" section.
- Typed Pydantic response models for the API routes (`backend/.../api/models.py`).
- Backend `poe gate` task mirroring CI (lint + format-check + mypy + pytest-cov).

### Changed
- **Dependencies modernized.** Backend: mypy 1.20→2.1, polars 1.41,
  pydantic 2.13.4, sentence-transformers 5.5, typer 0.26, uvicorn 0.48, plus
  raised constraint floors. Frontend: transformers.js 3.8→4.2 (onnxruntime-web
  1.26-dev), jsdom 26→29; pinned Node via `engines` + `.nvmrc`.
- `@edgeproc/browser/testing` is now browser-safe; the node-only fixture loader
  moved behind `@edgeproc/browser/testing/fixtures` so importing the test-seam
  barrel never drags `node:fs` into a browser bundle.

### Fixed
- **Both Playwright suites were silently broken** since the `backend/`+`frontend/`
  restructure: `catalog-server.mjs` still resolved the signed catalog at the
  pre-restructure repo-root `examples/` instead of `backend/examples/`.
- Removed `@rolldown/binding-darwin-arm64` from direct deps (it is an optional
  per-platform binding) — `npm ci` on the Linux CI runner no longer fails.

## [0.2.0] — 2026-05-28

The Nimbus demo goes **backend-free**: the SPA syncs the signed bundle and runs
the full hybrid-search + session-aware-rerank pipeline in the browser tab. No
application backend in the request path. The in-browser engine is extracted as
a reusable workspace package, and the demo gains its own frontend CI.

### Added
- `@edgeproc/browser` — new private npm workspace package
  (`frontend/packages/edgeproc-browser/`). In-browser signed-bundle sync into OPFS
  (ed25519 + sha256 fail-closed), reassembly, and the full hybrid-search engine
  (BM25 ⊕ vector → RRF → session rerank). Top-k parity-tested against the
  Python core over the same committed bundle.
- Browser embedder via transformers.js (`Xenova/all-MiniLM-L6-v2`,
  `{ pooling: "mean", normalize: true }`) — the byte-for-byte equivalent of the
  Python core's query encoder.
- Backend-free `docker compose up --build` path: `origin` → Caddy `edge` → static
  Nimbus SPA. No FastAPI in the request path; the browser does the search.
- Real 728-product Amazon catalog committed as the demo bundle
  (`examples/catalog/`), built via `edgereco build-catalog` → `index` → `bundle`.
- Frontend CI workflow: Biome lint + tsc + Vitest across the npm workspace plus
  Playwright end-to-end coverage of the backend-free hero loop (sync → search →
  click → rail re-rank → "why?" panel).

### Changed
- Top-level README + `CLAUDE.md` rewritten to make the backend-free demo the
  headline path; the Python FastAPI runtime is reframed as the optional
  server-side API variant.
- `@edgeproc/browser` public surface trimmed: low-level sync primitives
  (`MemoryCacheStore`, `syncIndex`, `materializeFile`, `Verify` / `FetchBytes`
  / `CacheStore`) moved behind the `./testing` subpath; the main entrypoint is
  the production runtime (`EngineRuntime`, `SearchEngine`, the domain types).
- Demo data layer (`frontend/app/src/api/client.ts`) refactored from
  module-level mutable state to a `createDataClient(runtime)` factory.

## [0.1.0] — 2026-04-30

First public release. Python v1 reference architecture for edge-first product discovery.

### Added
- Manifest-based catalog sync with sha256 checksums
- BM25 keyword index (`rank-bm25`) and FAISS vector index (`sentence-transformers/all-MiniLM-L6-v2`), built via `edgereco index`
- Reciprocal Rank Fusion hybrid search (`edgereco search`, `GET /search`)
- Session-aware reranker: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- Interaction event ingest (`POST /events`) with click / view / favorite / cart weights
- Recommendation endpoint with session signals (`GET /recommend`)
- Typer CLI: `index`, `serve`, `search`, `preprocess`
- FastAPI app with Protocol-based DI for edge clients (HTTP + filesystem adapters)
- Synthetic 1000-product demo catalog (superseded in 0.2.0 by the committed 728-product Amazon bundle built via `edgereco build-catalog`)
- Docker Compose stack: origin + Caddy edge + app, with healthcheck-gated startup
- BDD test suite (5 Gherkin features), integration + e2e coverage, 98%+ line coverage
- GitHub Actions CI: ruff + mypy strict + pytest with 90% coverage gate
