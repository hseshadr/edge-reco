# EdgeReco — MVP Roadmap (TDD/BDD)

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Draft |
| **Last Updated** | 2026-03-01 |
| **Companion Docs** | [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [Technical Specification](TECH_SPEC.md) |

---

> **TLDR** — **Phase 0 (Proof of Loop)** prepends the original 11-phase roadmap to prove the edge-reranking value proposition with a clickable demo, spec-first OpenAPI, and an IDB-persisted local profile — all before committing to WASM. See [`specs/phase-0-proof-of-loop.md`](specs/phase-0-proof-of-loop.md) and [`plans/phase-0-proof-of-loop.md`](plans/phase-0-proof-of-loop.md). After Phase 0 lands, the original **11 phases** continue: Phases 1–4 build foundations (monorepo, storage, Service Worker, manifest). Phase 5 builds the Rust WASM engine. Phase 6–7 build the Compute Worker, Hybrid Router (with device capability detection), and SDK API. Phases 8–10 complete artifact sync, engine hot-swap, and event uplink. Phase 11 hardens. **5 pipelines** define all runtime behavior: Artifact Distribution, Recommendation Request, Event Uplink, Engine Hot-Swap, Catalog Delta-Sync. **Critical path**: 0 → 1 → 2 → 3 → 4 → 8 → 9 → 11. Parallel tracks for engine (5→6→7) and events (2→10).

## 1. MVP Definition

### Core Thesis

Ship a working browser-based recommendation SDK that proves the CDN-first, local-first architecture end-to-end. A user installs the SDK, artifacts arrive via CDN, recommendations are produced locally by a WASM engine, and interaction events flow back to the backend — all with graceful backend fallback when local inference is unavailable.

### Pipeline Architecture

EdgeReco's runtime behavior is organized into **five pipelines** — deterministic, composable sequences of pure-ish functions. Each pipeline has typed step signatures (see [Section 3: Pipeline Catalog](#3-pipeline-catalog)). Implementation follows **pipeline-first TDD**: write failing tests for each step, implement the step, wire steps into the pipeline, then write integration tests for the full pipeline.

### MVP Success Criteria

| Criterion | Measurable Target |
|-----------|-------------------|
| Local inference works | `getRecommendations()` returns items with `source: "local"` |
| Backend fallback works | Kill switch or engine failure → `source: "backend"` |
| Artifacts distribute via CDN | Manifest poll → artifact download → OPFS/Cache storage |
| Engine hot-swap works | New manifest version → shadow load → smoke test → activate |
| Events reach backend | `reportInteraction()` → IDB queue → batch uplink → 202 Accepted |
| Offline works | Airplane mode → cached artifacts → local recommendations |
| Cold start < 3s | First recommendation within 3s of `init()` |
| Warm inference < 10ms (p95) | `reco_query()` latency measured by performance marks |

---

## 2. Tech Stack & Tooling

### Full Stack Table

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Engine Language | Rust | WASM engine source |
| WASM Toolchain | wasm-pack + wasm-bindgen | Rust → WASM compilation |
| SDK Language | TypeScript (strict) | SDK, Workers, Service Worker |
| Bundler | Vite | Build, dev server, Worker bundling |
| Package Manager | pnpm | Monorepo workspace management |
| Test Runner | Vitest | Unit + integration tests (TS) |
| E2E Framework | Playwright | Browser integration tests |
| Rust Test Runner | cargo test + wasm-pack test | Engine unit + WASM tests |
| BDD Specs | Vitest BDD syntax (`describe`/`it`) | Behavior-driven acceptance tests |
| Linter / Formatter | Biome | Lint + format (replaces ESLint + Prettier) |
| Type Checker | tsc --noEmit | Static type validation |
| CI | GitHub Actions | Build, test, lint, type-check |
| HTTP Mocking | msw (Mock Service Worker) | Intercept `fetch()` in Vitest + Playwright |
| IDB Mocking | fake-indexeddb | IndexedDB in-memory mock for Node/Vitest |
| Diagrams | D2 + Tala layout | Architecture documentation |

### Monorepo Structure

```
edgereco/
├── packages/
│   ├── sdk/                # EdgeReco class, Hybrid Router
│   ├── service-worker/     # SW lifecycle, Manifest Manager, Artifact Cache
│   ├── compute-worker/     # Compute Worker, SQLite integration
│   ├── storage/            # OPFS + IDB abstractions
│   ├── events/             # Event capture, queue, uplink
│   └── shared/             # Shared types, constants, interfaces
├── crates/
│   └── engine/             # Rust WASM engine (reco_init, reco_query, etc.)
├── test-fixtures/          # Shared mock catalogs, manifests, WASM stubs
├── playwright/             # E2E test suites
├── docs/                   # Documentation + diagrams
├── biome.json
├── tsconfig.json
├── pnpm-workspace.yaml
├── vitest.config.ts
└── .github/workflows/      # CI pipeline
```

---

## 3. Pipeline Catalog

Each pipeline is a sequence of typed steps. Steps are pure functions (or async with isolated side-effects) that compose into the full pipeline. Pipeline step types (`ManifestRecord`, `ManifestDiff`, `RecoRequest`, `RecoResponse`, `EdgeEvent`, `EventBatch`, etc.) are defined in [TECH_SPEC](TECH_SPEC.md) §§2, 5, 7, 8.

### Pipeline 1: Artifact Distribution

Distributes CDN artifacts to local storage. Triggered by manifest poll detecting changes.

```typescript
fetchManifest(url: string): Promise<ManifestRecord>
→ diffManifest(cached: ManifestRecord, fresh: ManifestRecord): ManifestDiff
→ downloadArtifact(url: string, expectedHash: string): Promise<ArrayBuffer>
→ verifyIntegrity(data: ArrayBuffer, expectedHash: string): boolean
→ cacheArtifact(cacheName: string, url: string, data: Response): Promise<void>
→ persistToOPFS(path: string, data: ArrayBuffer): Promise<void>
→ notifyWorker(client: Client, type: string, payload: object): void
```

| Step | Input | Output | Side Effect |
|------|-------|--------|-------------|
| `fetchManifest` | CDN URL | `ManifestRecord` | Network fetch |
| `diffManifest` | Two manifests | `ManifestDiff` with changed flags | None (pure) |
| `downloadArtifact` | URL + expected hash | Raw bytes | Network fetch |
| `verifyIntegrity` | Bytes + expected hash | `boolean` | None (pure) |
| `cacheArtifact` | Cache name + URL + Response | `void` | Cache API write |
| `persistToOPFS` | Path + bytes | `void` | OPFS write |
| `notifyWorker` | Client + message | `void` | postMessage |

### Pipeline 2: Recommendation Request

Routes a recommendation request to local engine or backend fallback.

```typescript
buildRecoRequest(placement: string, opts?: Partial<RecoRequest>): RecoRequest
→ routeRequest(req: RecoRequest, engineStatus: EngineState, killSwitch: boolean, capabilityTier: CapabilityTier): "local" | "backend"
→ localInference(payload: RecoQueryPayload): Promise<RecoResultPayload>
→ backendFallback(req: RecoRequest, backendUrl: string): Promise<BackendResponse>
→ assembleResponse(result: RecoResultPayload | BackendResponse, source: RecoSource, startTime: number): RecoResponse
```

| Step | Input | Output | Side Effect |
|------|-------|--------|-------------|
| `buildRecoRequest` | Placement + options | `RecoRequest` | None (pure) |
| `routeRequest` | Request + engine state + kill switch + capability tier | `"local"` or `"backend"` | None (pure) |
| `localInference` | Query payload | `RecoResultPayload` | Worker postMessage |
| `backendFallback` | Request + backend URL | `BackendResponse` | Network fetch |
| `assembleResponse` | Result + source + timing | `RecoResponse` | None (pure) |

### Pipeline 3: Event Uplink

Captures interaction events, queues them locally, and flushes to the backend.

```typescript
captureInteraction(event: InteractionEvent, anonymousId: string, sdkVersion: string): EdgeEvent
→ applySampling(event: EdgeEvent, rates: EventSamplingConfig): boolean
→ enqueueEvent(event: EdgeEvent, db: IDBDatabase): Promise<void>
→ assembleBatch(entries: EventQueueEntry[], maxCount: number, maxBytes: number): EventBatch
→ transmitBatch(batch: EventBatch, endpoint: string): Promise<boolean>
→ pruneQueue(db: IDBDatabase, sentIds: number[], maxRetries: number): Promise<void>
```

| Step | Input | Output | Side Effect |
|------|-------|--------|-------------|
| `captureInteraction` | Interaction + anonymous ID + version | `EdgeEvent` envelope | None (pure) |
| `applySampling` | Event + sampling rates | `boolean` (send or drop) | None (pure, deterministic hash) |
| `enqueueEvent` | Event + IDB handle | `void` | IDB write |
| `assembleBatch` | Queue entries + limits | `EventBatch` | None (pure) |
| `transmitBatch` | Batch + endpoint URL | `boolean` (success) | Network fetch / sendBeacon |
| `pruneQueue` | IDB handle + sent IDs + max retries | `void` | IDB delete |

### Pipeline 4: Engine Hot-Swap

Replaces the active WASM engine with a new version, including smoke testing.

```typescript
detectNewEngine(diff: ManifestDiff): NewEngineInfo | null
→ downloadEngine(url: string, expectedHash: string): Promise<ArrayBuffer>
→ shadowLoadEngine(wasmBytes: ArrayBuffer, configJson: string): Promise<void>
→ runSmokeTest(): Promise<SmokeTestResult>
→ activateOrRollback(result: SmokeTestResult): Promise<ActivationResult>
→ evictOldEngine(cacheName: string, previousUrl: string): Promise<void>
```

| Step | Input | Output | Side Effect |
|------|-------|--------|-------------|
| `detectNewEngine` | `ManifestDiff` | `NewEngineInfo` or `null` | None (pure) |
| `downloadEngine` | URL + hash | Raw WASM bytes | Network fetch |
| `shadowLoadEngine` | WASM bytes + config | `void` | WASM instantiation |
| `runSmokeTest` | — | `SmokeTestResult` | WASM execution |
| `activateOrRollback` | Smoke result | `{ activated: boolean }` | State swap or discard |
| `evictOldEngine` | Cache name + old URL | `void` | Cache API delete, OPFS delete |

### Pipeline 5: Catalog Delta-Sync

Updates the local catalog incrementally or via full snapshot.

```typescript
resolveSyncStrategy(currentHash: string, targetHash: string, deltaChain: DeltaEntry[]): SyncStrategy
→ downloadDelta(url: string, expectedHash: string): Promise<ArrayBuffer>
→ verifyBaseHash(db: SQLiteDB, expectedBase: string): boolean
→ applyDeltaPatch(db: SQLiteDB, patchPayload: ArrayBuffer): Promise<void>
→ verifyTargetHash(db: SQLiteDB, expectedTarget: string): boolean
→ fallbackToSnapshot(snapshotUrl: string, expectedHash: string): Promise<void>
```

| Step | Input | Output | Side Effect |
|------|-------|--------|-------------|
| `resolveSyncStrategy` | Current hash + target hash + delta chain | `"delta"` or `"snapshot"` | None (pure) |
| `downloadDelta` | URL + hash | Raw patch bytes | Network fetch |
| `verifyBaseHash` | DB handle + expected hash | `boolean` | DB read |
| `applyDeltaPatch` | DB handle + patch bytes | `void` | DB transaction |
| `verifyTargetHash` | DB handle + expected hash | `boolean` | DB read |
| `fallbackToSnapshot` | URL + hash | `void` | Network fetch + OPFS write |

---

## 4. Phased Task List

### Phase Dependency Graph

![Phase Dependencies](diagrams/mvp-phase-deps.svg)

> **Note (2026-04-11)**: Phase 0 was prepended to this roadmap after the original graph was rendered. The dependency SVG will be regenerated when Phase 0 lands. The new critical path starts at Phase 0: `0 → 1 → 2 → 3 → 4 → 8 → 9 → 11`.

---

### Phase 0 — Proof of Loop

**Status**: Active — added 2026-04-11 as the step-1 proof ahead of the WASM/OPFS build.

**Goal**: Prove the edge-reranking value proposition with a clickable demo backed by a real API contract, so that Phases 1–11 replace implementations behind stable interfaces rather than rewriting call sites.

**Companion docs**:
- Design spec: [`specs/phase-0-proof-of-loop.md`](specs/phase-0-proof-of-loop.md)
- Implementation plan: [`plans/phase-0-proof-of-loop.md`](plans/phase-0-proof-of-loop.md)

**Scope**: TS SDK (`packages/sdk`) with pure-function reranker and IDB-persisted profile; Python FastAPI service (`services/api`) with hexagonal wire/domain layering; spec-first OpenAPI (`packages/contracts/openapi.yaml`) with generated clients on both sides; Vite + React demo (`apps/demo-web`); Playwright flywheel test; CI with spec-drift + TS + Python + E2E gates.

**Out of scope** (deferred to their owner phases):

- WASM engine (Phase 5)
- Rust code / `crates/engine/` (Phase 5)
- Service Worker / Cache API (Phase 3)
- Manifest-driven CDN distribution (Phases 4, 8)
- OPFS / SQLite WASM catalog (Phase 6)
- Compute worker main-thread isolation (Phase 6)
- Hybrid Router fallback logic (Phase 7)
- Event queue/batch/uplink in full form (Phase 10)

**Relationship to Phases 1–11**: Phase 0 ships interfaces; each later phase replaces an implementation behind one of those interfaces. For example, Phase 5's WASM engine swaps the JS reranker behind the same scorer contract; Phase 3's Service Worker adds offline delivery without changing the SDK's public API. See the arc diagram in the design spec.

**Acceptance criteria**: see [`specs/phase-0-proof-of-loop.md`](specs/phase-0-proof-of-loop.md) §14. In short: clean checkout runs green on `pnpm install && pnpm generate && pnpm -r test && pnpm -r build && pnpm e2e`, the demo visually shifts toward clicked categories, and the profile persists across reload.

**Dependencies**: None (Phase 0 is the new starting point).

---

### Phase 1 — Project Scaffolding & CI

**Goal**: Establish the monorepo, toolchain, and CI pipeline so every subsequent phase has infrastructure for TDD from day one.

**Pipelines/Steps**: None (foundation phase).

**Architecture Components**: None directly; enables all.

**TDD Tasks**:

1. **Monorepo init**: pnpm workspace with `packages/shared`, `crates/engine`, `test-fixtures`
   - `pnpm install` succeeds, workspace packages resolve each other
2. **TypeScript config**: Strict tsconfig with path aliases across packages
   - `tsc --noEmit` passes with zero errors on an empty project
3. **Vitest setup**: Shared vitest config with workspace-aware test discovery
   - `vitest run` discovers and runs a trivial `shared/src/__tests__/sanity.test.ts`
4. **Biome config**: Lint + format rules
   - `biome check .` passes on scaffolded code
5. **Rust/wasm-pack setup**: `crates/engine/` with `Cargo.toml`, wasm-pack build target
   - `wasm-pack build --target web` produces `.wasm` + JS glue
   - `cargo test` passes a trivial test
6. **GitHub Actions CI**: Workflow runs lint, type-check, vitest, cargo test, wasm-pack build
   - All checks green on scaffolded repo
7. **Playwright setup**: Config file, example spec
   - `npx playwright test` runs and passes a trivial browser test
8. **Git hooks & commit conventions**: husky + commitlint
   - Pre-commit hook runs `biome check` and `tsc --noEmit`
   - Commit messages follow conventional commits (feat:, fix:, docs:, chore:)

**Acceptance Criteria**:

- [ ] `pnpm install && pnpm -r build` succeeds
- [ ] `pnpm vitest run` finds and passes test(s)
- [ ] `biome check .` passes
- [ ] `tsc --noEmit` passes
- [ ] `wasm-pack build --target web` produces valid WASM output
- [ ] CI workflow passes on push

**Dependencies**: None.

---

### Phase 2 — Storage Abstractions

**Goal**: Build tested, mockable wrappers around OPFS, IndexedDB, and Cache API so all subsequent phases depend on storage interfaces, not browser APIs directly.

**Pipelines/Steps**: Foundation for all five pipelines (every pipeline reads/writes storage).

**Architecture Components**: Storage Layer (OPFS, IDB, Cache API).

**TDD Tasks**:

1. **IDB schema manager** (`packages/storage/src/idb.ts`)
   - Test: open DB → verify object stores (`manifest`, `user_state`, `event_queue`, `sync_metadata`, `preferences`) exist with correct key paths
   - Test: schema migration — v1→v2 adds a store without data loss
2. **IDB typed accessors**
   - Test: `putManifest(record)` → `getManifest()` round-trips correctly
   - Test: `appendEvent(event)` → `drainEvents(limit)` returns FIFO, deletes returned entries
   - Test: `putUserState(state)` → `getUserState()` round-trips correctly
3. **OPFS wrapper** (`packages/storage/src/opfs.ts`)
   - Test: `writeFile("/edgereco/test.bin", bytes)` → `readFile("/edgereco/test.bin")` returns same bytes
   - Test: `deleteFile("/edgereco/test.bin")` → subsequent read throws
   - Test: `getUsage()` returns approximate byte count
4. **Cache API wrapper** (`packages/storage/src/cache.ts`)
   - Test: `putArtifact(url, response)` → `getArtifact(url)` returns cached response
   - Test: `evictArtifact(url)` → `getArtifact(url)` returns null
5. **Quota monitor** (`packages/storage/src/quota.ts`)
   - Test: `checkQuota()` returns `{ usageBytes, quotaBytes, percentUsed }`
   - Test: quota exceeding threshold triggers callback
6. **Quota eviction strategy** (`packages/storage/src/eviction.ts`)
   - Test: eviction priority order: old deltas first, then previous engine backup, then catalog backup
   - Test: critically low quota → skip catalog sync, keep current cached data
   - Test: storage write fails → reports error, returns failure flag

**Acceptance Criteria**:

- [ ] All IDB object stores created with correct schemas
- [ ] OPFS read/write/delete round-trips pass
- [ ] Cache API put/get/evict round-trips pass
- [ ] Quota monitor reports storage usage
- [ ] All storage operations have typed interfaces (no raw API calls leak to consumers)
- [ ] 100% of tests pass in Vitest with in-memory/mock storage fallbacks

**Dependencies**: Phase 1.

---

### Phase 3 — Service Worker Shell

**Goal**: Register a Service Worker with correct lifecycle (install → activate → claim), scoped fetch interception for `/edgereco/*` paths, and Cache API integration.

**Pipelines/Steps**: Foundation for Pipeline 1 (Artifact Distribution), Pipeline 5 (Catalog Delta-Sync).

**Architecture Components**: Service Worker, Artifact Cache Controller.

**TDD Tasks**:

1. **SW registration** (`packages/service-worker/src/register.ts`)
   - Test: `registerServiceWorker()` resolves when SW is active and controlling
   - Test: registration on a page without SW support rejects gracefully
2. **SW lifecycle** (`packages/service-worker/src/sw.ts`)
   - Test: on `install` → `skipWaiting()` called
   - Test: on `activate` → `clients.claim()` called
3. **Scoped fetch handler**
   - Test: request to `/edgereco/manifest.json` → intercepted by SW, served from Cache if available
   - Test: request to `/edgereco/engines/abc123.wasm` → Cache-first, network fallback
   - Test: request outside `/edgereco/` scope → passed through (not intercepted)
4. **Message handler shell**
   - Test: `postMessage({ type: "GET_STATUS" })` → responds with `{ type: "SYNC_STATUS", payload }`
   - Test: unknown message type → ignored (no crash)

**Acceptance Criteria**:

- [ ] SW registers, activates, and claims clients
- [ ] `/edgereco/*` fetches are Cache-first with network fallback
- [ ] Non-scoped fetches pass through untouched
- [ ] postMessage protocol established (GET_STATUS, FORCE_SYNC, FLUSH_EVENTS)
- [ ] Playwright test confirms SW active in real browser

**Dependencies**: Phase 1, Phase 2 (Cache API wrapper).

---

### Phase 4 — Manifest Manager

**Goal**: Implement manifest fetch, parse, diff, and poll loop inside the Service Worker.

**Pipelines/Steps**: `fetchManifest`, `diffManifest` (Pipeline 1). `detectNewEngine` (Pipeline 4). `resolveSyncStrategy` (Pipeline 5).

**Architecture Components**: Manifest Manager.

**TDD Tasks**:

1. **Manifest parser** (`packages/service-worker/src/manifest.ts`)
   - Test: valid manifest JSON → parsed `ManifestRecord` with all fields
   - Test: missing required fields → parse error with specific field name
   - Test: unknown `schema_version` → `UnsupportedSchemaError`
2. **Manifest diff** (`packages/service-worker/src/manifest-diff.ts`)
   - Test: identical manifests → `{ engineChanged: false, catalogChanged: false, configChanged: false }`
   - Test: new engine hash → `{ engineChanged: true }` with old/new hashes
   - Test: new catalog hash with delta chain available → `{ catalogChanged: true, deltaAvailable: true }`
   - Test: new catalog hash without delta path → `{ catalogChanged: true, deltaAvailable: false }`
3. **Canary bucketing** (`packages/service-worker/src/canary.ts`)
   - Test: `computeBucket(anonymousId, manifestVersion)` is deterministic
   - Test: bucket < canary percentage → returns canary engine info
   - Test: bucket >= canary percentage → returns main engine info
   - Test: canary disabled → always returns main engine
4. **Poll loop** (`packages/service-worker/src/poll.ts`)
   - Test: on timer tick → fetches manifest, diffs against cached, emits change events
   - Test: fetch failure → continues with cached manifest, no error thrown
   - Test: manifest unchanged → no artifact downloads triggered

**Acceptance Criteria**:

- [ ] Manifest parsed and validated against expected schema
- [ ] Diff correctly detects engine, catalog, and config changes
- [ ] Canary bucketing is deterministic and respects percentage
- [ ] Poll loop runs on configured interval, handles fetch failures gracefully
- [ ] Kill switch flag is extracted and available to consumers

**Dependencies**: Phase 3 (SW lifecycle).

---

### Phase 5 — WASM Engine Core (Rust)

**Goal**: Build the Rust recommendation engine that compiles to WASM and exports `reco_init`, `reco_query`, `reco_smoke_test`, `reco_apply_config`.

**Pipelines/Steps**: `localInference` (Pipeline 2), `runSmokeTest` (Pipeline 4).

**Architecture Components**: WASM Engine.

**TDD Tasks**:

1. **Engine init** (`crates/engine/src/lib.rs`)
   - Test (Rust): `reco_init(model_bytes, config_json)` returns 0 on valid inputs
   - Test (Rust): `reco_init` with malformed config → non-zero error code
   - Test (Rust): `reco_init` with empty model bytes → non-zero error code
2. **Recommendation scoring** (`crates/engine/src/scoring.rs`)
   - Test (Rust): given known item features + user state → produces deterministic ranked output
   - Test (Rust): `diversity_factor: 0.0` → all results from top category; `diversity_factor: 1.0` → results span ≥3 categories (given sufficient catalog)
   - Test (Rust): respects `num_results` limit
3. **Query interface** (`crates/engine/src/lib.rs`)
   - Test (Rust): `reco_query(context_json)` returns valid JSON with `items` array
   - Test (Rust): each item has `itemId`, `score` (0-1), optional `reason`
   - Test (Rust): malformed context JSON → returns error JSON
4. **Smoke test** (`crates/engine/src/smoke.rs`)
   - Test (Rust): `reco_smoke_test()` returns `{ pass: true }` after valid init
   - Test (Rust): smoke test returns `{ pass: false }` if engine not initialized
5. **Config update** (`crates/engine/src/lib.rs`)
   - Test (Rust): `reco_apply_config(new_config)` updates scoring parameters without re-init
   - Test (Rust): unknown config fields are tolerated (forward-compatible)
6. **WASM build**
   - Test: `wasm-pack build --target web` produces `.wasm` + JS bindings
   - Test (wasm-pack): `reco_init` → `reco_query` round-trip works in headless Chrome
7. **Test fixture WASM stubs** (`crates/stub-engine/`)
   - Build `stub-engine.wasm`: minimal crate returning canned results (5 items, deterministic scores)
   - Build `failing-engine.wasm`: crate that traps on `reco_query()` (for fallback testing)
   - Both placed in `test-fixtures/engines/`

**Acceptance Criteria**:

- [ ] `cargo test` passes all Rust unit tests
- [ ] `wasm-pack test --headless --chrome` passes WASM integration tests
- [ ] Given fixed model weights, config, and query context, `reco_query()` returns identical item ordering across runs; items sorted by descending `score`
- [ ] Smoke test validates output shape, item count, and latency
- [ ] Config updates take effect without engine restart
- [ ] WASM binary < 2MB gzipped

**Dependencies**: Phase 1 (Rust toolchain).

---

### Phase 6 — Compute Worker & SQLite

**Goal**: Build the Compute Worker that hosts the WASM engine and SQLite catalog, with postMessage protocol for communication with the main thread.

**Pipelines/Steps**: `localInference` orchestration (Pipeline 2), `shadowLoadEngine` (Pipeline 4), `applyDeltaPatch` / `verifyBaseHash` / `verifyTargetHash` (Pipeline 5).

**Architecture Components**: Compute Worker, SQLite WASM.

**TDD Tasks**:

1. **Worker lifecycle** (`packages/compute-worker/src/worker.ts`)
   - Test: Worker boots, loads WASM from OPFS, posts `READY` message
   - Test: Worker posts `ERROR` if WASM binary not found in OPFS
2. **postMessage protocol**
   - Test: `RECO_QUERY` command → returns `RECO_RESULT` with items
   - Test: `GET_STATUS` command → returns `STATUS` with engine state
   - Test: `LOAD_ENGINE` command → loads new WASM, returns `ENGINE_LOADED`
   - Test: `SHUTDOWN` command → flushes state, terminates cleanly
   - Test: unknown command type → returns `ERROR` response
3. **SQLite integration** (`packages/compute-worker/src/sqlite.ts`)
   - Test: open `catalog.db` from OPFS → query `products` table → returns rows
   - Test: query by `category_id` → returns filtered products
   - Test: query `popularity DESC` → returns items in descending popularity order
   - Test: missing or corrupt DB file → returns meaningful error
4. **User state loading** (`packages/compute-worker/src/user-state.ts`)
   - Test: read `UserLocalState` from IDB → pass as input to `reco_query`
   - Test: missing user state → use empty defaults (no crash)
5. **Query execution pipeline** (wiring)
   - Test: `RECO_QUERY` → loads user state from IDB + queries catalog via SQLite + calls `reco_query` → returns scored items
   - Test: concurrent `RECO_QUERY` messages → processed sequentially (queue behavior)

**Acceptance Criteria**:

- [ ] Compute Worker boots and posts READY
- [ ] Full query path: RECO_QUERY command returns `RecoResultPayload` with ≥1 item, each having `itemId` matching a catalog product and `score` in [0,1]
- [ ] postMessage protocol handles all command types from TECH_SPEC
- [ ] SQLite catalog opens from OPFS and supports read queries
- [ ] Worker posts ERROR message with `code` and `message` fields on failure; does not crash or become unresponsive

**Dependencies**: Phase 2 (OPFS + IDB), Phase 5 (WASM binary).

---

### Phase 7 — Hybrid Router & SDK API

**Goal**: Implement the Hybrid Router decision algorithm and the public `EdgeReco` SDK API (`init`, `getRecommendations`, `reportInteraction`, `destroy`, `getHealthStatus`).

**Pipelines/Steps**: `buildRecoRequest`, `routeRequest`, `assembleResponse` (Pipeline 2). `backendFallback` (Pipeline 2).

**Architecture Components**: Hybrid Router, SDK API Layer.

**TDD Tasks**:

1. **Hybrid Router** (`packages/sdk/src/router.ts`)
   - Test: kill switch active → routes to `"backend"` regardless of engine state
   - Test: engine state `READY` → routes to `"local"`
   - Test: engine state `INITIALIZING` → routes to `"backend"`
   - Test: engine state `ERROR` → routes to `"backend"`
2. **Local inference with timeout** (`packages/sdk/src/router.ts`)
   - Test: local result within timeout → returns result with `source: "local"`
   - Test: local result exceeds timeout → cancels, falls back to backend
   - Heartbeat mechanism: main thread sends periodic `GET_STATUS` pings (every 2s); if no response within 5s, Worker is considered unresponsive
   - Test: Worker responds to GET_STATUS within 100ms under normal load
   - Test: Worker non-response for 5s → main thread terminates Worker, creates new one, routes to backend
3. **Backend fallback** (`packages/sdk/src/backend.ts`)
   - Test: `POST /v1/recommendations` with correct body → returns items
   - Test: backend returns 500 → returns degraded result (empty items, `source: "degraded"`)
   - Test: backend unreachable → returns degraded result
4. **Response assembly** (`packages/sdk/src/response.ts`)
   - Test: local `RecoResultPayload` → `RecoResponse` with `source: "local"`, computed latency, traceId
   - Test: backend response → `RecoResponse` with `source: "backend"`
   - Test: degraded path → `RecoResponse` with `source: "degraded"`, empty items
5. **SDK public API** (`packages/sdk/src/edgereco.ts`)
   - Test: `EdgeReco.init(config)` → registers SW, boots Compute Worker, resolves when ready
   - Test: `getRecommendations(req)` → delegates to router, returns `RecoResponse`
   - Test: `reportInteraction(event)` → queues event (non-blocking)
   - Test: `destroy()` → stops workers, flushes events
   - Test: `destroy(true)` → wipes all storage
   - Test: `getHealthStatus()` → returns current state, versions, storage usage
6. **Degradation ladder** (`packages/sdk/src/degradation.ts`)
   - Test: engine ready + fresh catalog → level 1 (full local)
   - Test: engine ready + stale catalog → level 2 (stale local)
   - Test: engine unavailable + backend reachable → level 3 (backend fallback)
   - Test: engine unavailable + backend unreachable + cached catalog → level 4 (degraded)
   - Test: no engine, no backend, no cache → level 5 (empty)
7. **Capability detection** (`packages/sdk/src/capability.ts`)
   - Test: `hardwareConcurrency < 2` → tier "insufficient"
   - Test: `hardwareConcurrency` undefined → assume capable, proceed to Tier 2
   - Test: `deviceMemory < 1` (Chromium) → tier "insufficient"
   - Test: `deviceMemory` undefined (Firefox/Safari) → skip memory check, proceed
   - Test: `deviceMemory >= 4` and `cores >= 4` → tier "high" (no benchmark needed)
   - Test: micro-benchmark > 150ms → tier "insufficient"
   - Test: micro-benchmark < 50ms → tier "high"
   - Test: micro-benchmark 50-150ms → tier "medium"
   - Test: 3 benchmark iterations, median selected for stability
   - Test: cached profile within TTL → returns cached tier, skips detection
   - Test: cached profile expired (> 7 days) → runs fresh detection
   - Test: cached profile from different SDK version → runs fresh detection
   - Test: `capabilityOverride: "backend"` → tier "insufficient", no detection runs
   - Test: `capabilityOverride: "local"` → tier "high", no detection runs
   - Test: `CAPABILITY_DETECTED` event emitted with tier (not raw hardware values)
   - Test: total detection time < 51ms
8. **Capability-aware routing** (update to `packages/sdk/src/router.ts`)
   - Test: tier "insufficient" → routes to "backend" regardless of engine state
   - Test: tier "medium" → routes to "local" with extended timeout (500ms)
   - Test: tier "high" → routes to "local" with default timeout (200ms)
   - Test: kill switch takes priority over capability tier
   - Test: `FALLBACK` event includes `reason: "capability_blocked"` when tier insufficient

**Acceptance Criteria**:

- [ ] Hybrid Router: all 5 branches from TECH_SPEC §2 pseudocode tested: kill_switch, capability gate, engine not READY, timeout, success
- [ ] Capability detection returns correct tier across Chromium, Firefox, Safari (API availability varies)
- [ ] Timeout mechanism works (local cancel + backend fallback)
- [ ] All five degradation levels reachable and tested
- [ ] `EdgeReco` class matches the public API contract from TECH_SPEC Section 9
- [ ] `destroy(true)` wipes OPFS + IDB + Cache API entries
- [ ] Playwright E2E: `getRecommendations()` returns items with `source: 'local'` within 3s of `init()`

**Dependencies**: Phase 6 (Compute Worker), Phase 3 (SW registration).

---

### Phase 8 — Artifact Distribution & Delta Sync

**Goal**: Implement full artifact download, content-addressed integrity verification, delta patch application, and background sync orchestration.

**Pipelines/Steps**: Full Pipeline 1 (Artifact Distribution). Full Pipeline 5 (Catalog Delta-Sync).

**Architecture Components**: Artifact Cache Controller, Background Sync Orchestrator.

**TDD Tasks**:

1. **Artifact download + integrity** (`packages/service-worker/src/artifact.ts`)
   - Test: download artifact → SHA256 matches URL hash → cache + persist
   - Test: download artifact → SHA256 mismatch → discard, return error
   - Test: network failure → return error, do not corrupt cache
2. **Content-addressed URL parsing** (`packages/shared/src/content-address.ts`) — Pattern: `/edgereco/{type}s/{sha256hex}.{ext}` per TECH_SPEC §14B
   - Test: `/edgereco/engines/abc123.wasm` → extracts hash `abc123`
   - Test: URL without hash pattern → returns null
3. **Delta patch format parser** (`packages/service-worker/src/delta.ts`) — Delta binary format defined in TECH_SPEC §6 (Delta Patch Binary Format)
   - Test: valid binary → parses magic bytes, format version, base hash, target hash, payload
   - Test: wrong magic bytes → parse error
   - Test: truncated binary → parse error
4. **Delta patch application** (`packages/compute-worker/src/delta-apply.ts`)
   - Test: apply patch to base catalog → verify target hash matches
   - Test: base hash mismatch → reject patch, trigger full snapshot
   - Test: SQL execution error in patch → rollback transaction
5. **Sync strategy resolution** (`packages/service-worker/src/sync-strategy.ts`)
   - Test: current hash in delta chain → choose delta path
   - Test: current hash not in delta chain → choose full snapshot
   - Test: delta chain empty → choose full snapshot
6. **Background sync orchestrator** (`packages/service-worker/src/sync-orchestrator.ts`)
   - Test: manifest diff with engine change → triggers engine download + notify
   - Test: manifest diff with catalog change + delta available → triggers delta sync
   - Test: manifest diff with catalog change + no delta → triggers full snapshot download
   - Test: manifest diff with config change → triggers config download + notify

**Acceptance Criteria**:

- [ ] Artifacts verified against SHA256 before caching
- [ ] Corrupt downloads are discarded (never cached)
- [ ] Delta patches apply within a transaction with rollback on failure
- [ ] Hash mismatch after delta → automatic fallback to full snapshot
- [ ] Background sync orchestrates engine, catalog, and config updates from a single manifest diff
- [ ] All sync metadata stored in IDB (`sync_metadata` store)

**Dependencies**: Phase 3 (SW + Cache API), Phase 4 (manifest diff).

---

### Phase 9 — Engine Hot-Swap & Smoke Test

**Goal**: Implement the full engine hot-swap lifecycle: detect → download → shadow load → smoke test → activate/rollback. Plus canary rollout logic.

**Pipelines/Steps**: Full Pipeline 4 (Engine Hot-Swap).

**Architecture Components**: Smoke Test Harness, Engine Hot-Swap (part of Compute Worker + SW coordination).

**TDD Tasks**:

1. **New engine detection** (`packages/service-worker/src/hot-swap.ts`)
   - Test: manifest diff with engine change → returns `{ hash, url, semver }`
   - Test: manifest diff without engine change → returns null
   - Test: canary engine selected by bucketing → returns canary engine info
2. **Shadow load** (`packages/compute-worker/src/hot-swap.ts`)
   - Test: `LOAD_ENGINE` command → new WASM instantiated alongside old engine
   - Test: load failure (corrupt WASM) → old engine continues, error reported
3. **Smoke test execution** (`packages/compute-worker/src/smoke-test.ts`)
   - Test: smoke test on valid engine → `{ pass: true, details }` with valid output shape
   - Test: smoke test validates result has >= 1 item
   - Test: smoke test validates all item IDs exist in catalog
   - Test: smoke test validates inference time < 100ms
4. **Activate / rollback** (`packages/compute-worker/src/hot-swap.ts`)
   - Test: smoke passes → new engine becomes active, status = READY
   - Test: smoke fails → new engine discarded, old engine remains active
   - Test: activation updates `sync_metadata` in IDB
5. **Old engine eviction** (`packages/service-worker/src/eviction.ts`)
   - Test: after successful activation → old engine binary deleted from Cache + OPFS
   - Test: eviction failure (file locked) → logged but does not block activation
6. **End-to-end hot-swap** (Playwright)
   - Test: publish new manifest with new engine → SW detects → downloads → smoke tests → activates → subsequent queries use new engine version

**Acceptance Criteria**:

- [ ] Hot-swap lifecycle executes all 6 pipeline steps in order
- [ ] After smoke test failure: old engine version hash unchanged in EngineStatus, no partial state, next RECO_QUERY succeeds with old engine
- [ ] Old engine never evicted until new engine passes smoke test
- [ ] Canary bucketing selects correct engine version
- [ ] System events emitted: `ENGINE_SWAP` (success/failure), `SMOKE_TEST` (pass/fail)
- [ ] Playwright E2E: full hot-swap cycle works in real browser

**Dependencies**: Phase 4 (version detection), Phase 7 (engine readiness), Phase 8 (artifact cache).

---

### Phase 10 — Event System & Uplink

**Goal**: Implement interaction event capture, local IDB queue, batch assembly, and uplink via `fetch`/`sendBeacon`.

**Pipelines/Steps**: Full Pipeline 3 (Event Uplink).

**Architecture Components**: Event capture (SDK API), Event Queue (IDB), Background Sync Orchestrator (event flush part).

**TDD Tasks**:

1. **Event capture** (`packages/events/src/capture.ts`)
   - Test: `captureInteraction({ type: "click", itemId, placement })` → returns well-formed `EdgeEvent` envelope
   - Test: envelope includes anonymous ID (as `deviceId` field), `sdkVersion`, `engineVersion`, `timestamp`
   - Test: `captureInteraction` with missing required fields → throws validation error
   - Test: `EdgeEvent` envelope contains only anonymous ID (as `deviceId`), never authenticated user ID, email, or IP
   - Test: event `data` field contains only item IDs and placement strings, no user-identifiable metadata
2. **Sampling** (`packages/events/src/sampling.ts`)
   - Test: interaction event with `interaction_rate: 0.1` → ~10% of events pass
   - Test: error events with `error_rate: 1.0` → 100% pass
   - Test: sampling is deterministic per `anonymousId + eventType + hourBucket`
3. **IDB queue** (`packages/events/src/queue.ts`)
   - Test: `enqueue(event)` → stored in `event_queue` store with auto-increment key
   - Test: `drain(50)` → returns up to 50 entries, FIFO order
   - Test: queue bounded at 1000 → oldest dropped when exceeded
   - Test: `retryCount > 3` entries dropped on prune
4. **Batch assembly** (`packages/events/src/batch.ts`)
   - Test: 30 events → single batch with `count: 30`
   - Test: 60 events → capped at 50 per batch (returns remainder for next batch)
   - Test: batch serialized JSON < 64KB enforced
   - Test: batch includes `batchId` (UUID) and `assembledAt` timestamp
5. **Uplink transport** (`packages/events/src/uplink.ts`)
   - Test: `transmitBatch(batch, endpoint)` → POST with `application/json`, returns true on 202
   - Test: 500 response → returns false (retry)
   - Test: 400 response → returns false (no retry, events dropped)
   - Test: network error → returns false (retry)
6. **sendBeacon fallback** (`packages/events/src/beacon.ts`)
   - Test: on `visibilitychange` (hidden) → pending events flushed via `sendBeacon`
   - Test: `sendBeacon` returns false (payload too large) → events remain queued
7. **Periodic flush** (SW integration)
   - Test: timer fires → drain queue → assemble batch → transmit → prune sent events
   - Test: flush during transmit failure → events remain for next flush
8. **System & metric event production** (`packages/events/src/system-events.ts`)
   - Test: engine swap success → `ENGINE_SWAP` event enqueued with `data: { result: "success" }`
   - Test: smoke test failure → `SMOKE_TEST` event enqueued with `data: { pass: false }`
   - Test: fallback triggered → `FALLBACK` event enqueued with source and reason
   - Test: `ERROR` event enqueued on WASM crash, SQLite error, etc.
   - Test: `ENGINE_LOADED` event enqueued on initial engine load
   - Test: `LATENCY` and `STORAGE_USAGE` metric events route through same queue/uplink pipeline

**Acceptance Criteria**:

- [ ] `reportInteraction()` is non-blocking (returns immediately)
- [ ] Events sampled deterministically per device/type/hour
- [ ] Batch assembly respects 50-event and 64KB limits
- [ ] Successful uplink → events deleted from queue
- [ ] Failed uplink → events remain with incremented retryCount
- [ ] `sendBeacon` fires on page visibility change
- [ ] Events with `retryCount > 3` are silently dropped
- [ ] Queue size bounded at 1000 entries
- [ ] All 12 event types from TECH_SPEC §8 are produced, queued, and uplinked through Pipeline 3

**Dependencies**: Phase 2 (IDB event queue).

---

### Phase 11 — Observability, Health & Hardening

**Goal**: Wire up client-side metrics, the health status API, kill switch enforcement, performance budget validation, and comprehensive E2E test coverage.

**Pipelines/Steps**: Cross-cutting — consumes outputs from all pipelines.

**Architecture Components**: Observability, Kill Switch, Degradation Ladder, Health Status API.

**TDD Tasks**:

1. **Client metrics collection** (`packages/sdk/src/metrics.ts`)
   - Test: `reco.latency` histogram recorded after each `getRecommendations()`
   - Test: `reco.source` counter incremented per source type
   - Test: `engine.swap` counter incremented on hot-swap attempt
   - Test: `catalog.sync` counter incremented on sync
   - Test: `storage.usage` gauge updated periodically
2. **Metrics serialization as events**
   - Test: metrics serialized as `EdgeEvent` with type `LATENCY` / `STORAGE_USAGE`
   - Test: metrics subject to `metric_rate` sampling
3. **Health status** (`packages/sdk/src/health.ts`)
   - Test: `getHealthStatus()` returns `state`, engine/catalog versions, `lastSyncAge`, `storageUsageBytes`, `pendingEvents`
   - Test: state transitions: healthy → degraded → backend_only → offline
4. **Kill switch enforcement** (`packages/sdk/src/kill-switch.ts`)
   - Test: kill switch active in manifest → Hybrid Router skips local, routes all to backend
   - Test: kill switch deactivated → local inference resumes on next manifest poll
   - Test: kill switch propagates within one poll interval
5. **Performance budget assertions** (Vitest + Playwright)
   - Test: cold start < 3s (E2E with mock CDN)
   - Test: warm inference p95 < 10ms (benchmark test)
   - Test: WASM binary < 2MB gzipped (build artifact check)
   - Test: main thread blocking < 1ms per SDK call (no synchronous WASM on main thread)
6. **Comprehensive E2E suite** (Playwright)
   - Test: cold start → first local recommendation
   - Test: warm start → immediate local recommendation
   - Test: engine hot-swap while serving requests
   - Test: kill switch activated mid-session → backend fallback
   - Test: offline mode (network disabled) → cached recommendations
   - Test: `destroy(true)` → all storage wiped

**Acceptance Criteria**:

- [ ] All 9 client metrics from ARCHITECTURE.md Section 9 are collected
- [ ] Health status API returns correct state at each degradation level
- [ ] Kill switch enforcement tested end-to-end
- [ ] Performance budgets from TECH_SPEC Section 12 are validated in CI
- [ ] Playwright covers all 4 user journeys from PRD §7: cold start (7.1), warm start (7.2), engine update (7.3), degraded/fallback (7.4)
- [ ] Vitest static analysis: no `WebAssembly.instantiate` calls outside Worker files; Playwright: main thread long-task budget < 1ms per SDK call

**Dependencies**: Phase 7 (health API), Phase 9 (swap metrics), Phase 10 (uplink metrics).

---

## 5. Phase Dependency Diagram

```
Phase 1 (Scaffolding)
├──→ Phase 2 (Storage)
│    ├──→ Phase 3 (Service Worker)
│    │    ├──→ Phase 4 (Manifest)
│    │    │    ├──→ Phase 8 (Artifact Distribution)
│    │    │    └──→ Phase 9 (Hot-Swap)
│    │    ├──→ Phase 7 (Hybrid Router + SDK API) [SW registration]
│    │    └──→ Phase 8 (Artifact Distribution)
│    ├──→ Phase 6 (Compute Worker + SQLite)
│    │    └──→ Phase 7 (Hybrid Router + SDK API)
│    │         ├──→ Phase 9 (Hot-Swap)
│    │         └──→ Phase 11 (Observability)
│    └──→ Phase 10 (Event System)
│         └──→ Phase 11 (Observability)
└──→ Phase 5 (WASM Engine)
     └──→ Phase 6 (Compute Worker + SQLite)
```

**Critical path**: 1 → 2 → 3 → 4 → 8 → 9 → 11

**Parallel tracks after Phase 1**:
- **Track A** (infra): 2 → 3 → 4 → 8 → 9
- **Track B** (engine): 5 → 6 → 7
- **Track C** (events): 2 → 10

Tracks converge at Phase 9 (hot-swap needs router + artifacts) and Phase 11 (needs everything).

---

## 6. MVP Scope Boundary

### Included in MVP

| Feature | Source | Phase |
|---------|--------|-------|
| WASM engine inference (Rust → WASM) | ARCHITECTURE.md §3, TECH_SPEC §4 | 5, 6 |
| Hybrid Router (local + backend fallback) | ARCHITECTURE.md §3, TECH_SPEC §2 | 7 |
| SDK public API (init, getRecommendations, reportInteraction, destroy, getHealthStatus) | TECH_SPEC §9 | 7 |
| Service Worker lifecycle + Cache API | ARCHITECTURE.md §3, TECH_SPEC §3 | 3 |
| Manifest fetch, parse, diff, poll | ARCHITECTURE.md §5, TECH_SPEC §7 | 4 |
| Content-addressed artifact distribution | ARCHITECTURE.md §5, TECH_SPEC §6 | 8 |
| Catalog delta-sync | ARCHITECTURE.md §5, TECH_SPEC §6 | 8 |
| Engine hot-swap + smoke test | ARCHITECTURE.md §6 | 9 |
| Canary bucketing | ARCHITECTURE.md §6, TECH_SPEC §7 | 4, 9 |
| Kill switch | ARCHITECTURE.md §8 | 11 |
| Event uplink (sendBeacon + fetch) | TECH_SPEC §8 | 10 |
| Event sampling | TECH_SPEC §8 | 10 |
| IDB storage (all 5 object stores) | TECH_SPEC §5 | 2 |
| OPFS storage (catalog + engine) | TECH_SPEC §5 | 2 |
| User state (local personalization) | ARCHITECTURE.md §7, TECH_SPEC §5 | 6, 7 |
| Anonymous device ID | ARCHITECTURE.md §7 | 2 |
| Degradation ladder (5 levels) | ARCHITECTURE.md §8 | 7, 11 |
| Client-side observability metrics | ARCHITECTURE.md §9 | 11 |
| Quota management | TECH_SPEC §5 | 2 |
| Backend fallback API integration | TECH_SPEC §9 | 7 |

### Deferred (Post-MVP)

| Feature | Source | Rationale |
|---------|--------|-----------|
| Native mobile SDK (iOS/Android `IRecoRuntime`) | ARCHITECTURE.md §11, TECH_SPEC §10 | Requires native build toolchain; web MVP proves the artifact format first |
| Authenticated identity merge | ARCHITECTURE.md §7 | Level 2 identity is optional; MVP uses anonymous-only |
| Inventory validation API integration | TECH_SPEC §9 | Nice-to-have; local catalog has `in_stock` flag |
| WASM Threads (SharedArrayBuffer) | ARCHITECTURE.md §13B | Not needed for MVP scoring workload |
| Lighthouse custom audits | TECH_SPEC §13 | Performance budgets validated via Playwright/Vitest instead |
| `periodicSync` API | TECH_SPEC §14C | Uses `setInterval` fallback; periodicSync browser support limited |
| IndexedDB fallback for OPFS | TECH_SPEC §14C | MVP targets browsers with OPFS support (Chrome 86+, Safari 16.4+) |
| Config `schema_version` migration | TECH_SPEC §11 | MVP ships with schema_version 1 only |
| Multi-algorithm engine | PRD §11 OQ2 | Single algorithm for MVP |
| Catalog segmentation (large retailers) | PRD §11 R2 | MVP targets catalogs < 10MB gzipped |

---

## 7. Mock & Test Fixture Strategy

### Shared Test Fixtures (`test-fixtures/`)

```
test-fixtures/
├── manifests/
│   ├── valid-manifest.json        # Complete valid manifest
│   ├── canary-manifest.json       # Manifest with canary enabled
│   ├── killswitch-manifest.json   # Manifest with kill_switch: true
│   └── minimal-manifest.json      # Minimum required fields only
├── catalogs/
│   ├── test-catalog.db            # SQLite DB with 100 test products
│   ├── test-catalog-v2.db         # Updated catalog for delta testing
│   └── test-delta.patch           # Binary delta from v1 → v2
├── datasets/
│   └── README.md                  # Documents prototype dataset source & field mapping
│   # Test catalogs are seeded from the prototype dataset (Amazon Reviews 2023
│   # — All Beauty, ~117K products). Any dataset conforming to the catalog
│   # schema (see TECH_SPEC.md §6) can be swapped in.
├── engines/
│   ├── stub-engine.wasm           # Minimal WASM that returns canned results
│   └── failing-engine.wasm        # WASM that traps on reco_query (for fallback testing)
├── configs/
│   └── test-config.json           # Valid engine config
├── events/
│   └── sample-events.json         # Array of sample EdgeEvent objects
└── helpers/
    ├── mock-fetch.ts              # fetch() mock with configurable responses
    ├── mock-cache-api.ts          # Cache API in-memory mock
    ├── mock-idb.ts                # IndexedDB in-memory mock (fake-indexeddb)
    ├── mock-opfs.ts               # OPFS in-memory mock
    ├── mock-service-worker.ts     # SW registration mock
    └── mock-broadcast-channel.ts  # BroadcastChannel mock
```

### Mock Strategy by Phase

| Phase | Key Mocks | Real APIs Tested |
|-------|-----------|-----------------|
| 2 (Storage) | None — tests use real IDB/OPFS in Vitest browser mode, or `fake-indexeddb` | IDB, OPFS, Cache API |
| 3 (Service Worker) | `mock-fetch` for CDN responses | SW lifecycle (Playwright) |
| 4 (Manifest) | `mock-fetch` for manifest JSON | Manifest parsing (pure) |
| 5 (WASM Engine) | None — tests use `cargo test` and `wasm-pack test` | Rust/WASM execution |
| 6 (Compute Worker) | `mock-opfs` (provides test catalog), `mock-idb` (user state) | Worker postMessage, SQLite |
| 7 (Hybrid Router) | Mock Compute Worker (canned responses), `mock-fetch` (backend) | Router logic (pure), SDK API |
| 8 (Artifact Distribution) | `mock-fetch` (CDN artifacts), `mock-cache-api`, `mock-opfs` | Integrity verification (pure) |
| 9 (Hot-Swap) | `stub-engine.wasm`, `failing-engine.wasm` | Smoke test, activation lifecycle |
| 10 (Events) | `mock-idb` (event queue), `mock-fetch` (uplink endpoint) | Sampling (pure), batch assembly (pure) |
| 11 (Observability) | All mocks from previous phases | Metrics collection, health computation |

### Mock Principles

1. **Pure functions need no mocks** — `diffManifest`, `routeRequest`, `applySampling`, `assembleBatch`, `verifyIntegrity`, etc. are tested with plain inputs and assertions.
2. **Storage mocks are thin wrappers** — Use `fake-indexeddb` for IDB, in-memory `Map` for OPFS/Cache. These mocks implement the same interface as the Phase 2 storage abstractions.
3. **Network mocks use `msw`** (Mock Service Worker) — Intercepts `fetch()` calls with configurable responses. Used for CDN artifact fetches, backend fallback API, and event uplink endpoint.
4. **WASM stubs** — `stub-engine.wasm` is a real WASM binary compiled from a minimal Rust crate that returns canned recommendations. Used in phases 6-11 when the real engine is not the test subject.
5. **Playwright uses a real HTTP server** — A test server serves fixtures from `test-fixtures/` at `localhost:3000/edgereco/*`. No mocking in E2E tests.
