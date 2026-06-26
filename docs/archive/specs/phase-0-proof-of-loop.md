# Phase 0 — Proof of Loop

| Field | Value |
|-------|-------|
| **Phase** | 0 (prepended to the existing 11-phase MVP roadmap) |
| **Type** | Design spec |
| **Status** | Approved, ready to implement |
| **Authored** | 2026-04-11 |
| **Companion Plan** | [`plans/phase-0-proof-of-loop.md`](../plans/phase-0-proof-of-loop.md) |
| **Upstream Docs** | [PRD](../PRD.md) · [Architecture](../ARCHITECTURE.md) · [Tech Spec](../TECH_SPEC.md) · [MVP Roadmap](../MVP_ROADMAP.md) |

---

## 1. Context

EdgeReco's committed long-term architecture is ambitious: a Rust WASM engine, SQLite WASM in OPFS, a manifest-driven CDN artifact pipeline, a dedicated Compute Worker, a Hybrid Router with device-capability detection, and a 5-pipeline runtime spanning eleven phases. That architecture is the right **north star**, but it is entirely unproven at the product level — no code exists yet — and its first demonstrable milestone is far away.

Phase 0 cuts the distance. Before investing in the infrastructure, we prove the core value proposition — **personalization logic lives in the browser** — with a loop small enough to demo end-to-end in one session:

> A user opens a page, clicks a few items, and the displayed recommendations visibly shift to match their revealed preferences — all reranking computed locally, with a persistent profile, backed by a real API contract.

Phase 0 is explicitly **step 1 on the arc to the north star**, not a disposable prototype. Every interface Phase 0 ships (`createEdgeRecoSdk`, `trackImpression`, `getCandidates`, the reranker contract, the candidate client, the OpenAPI schemas) is the same surface Phases 1–11 consume. Later phases **replace implementations behind stable interfaces**; they do not rewrite call sites.

### Why this is worth doing before starting Phase 1

1. **De-risks the value proposition.** Until the reranking loop is visible to a human, the rest of the architecture is speculation. Building WASM, OPFS, or a service worker before the loop is a commitment to infrastructure whose payoff is unverified.
2. **Locks in the public API.** The SDK surface that Phase 0 proves is the same surface every later phase must preserve. Designing it once, against a working demo, prevents interface churn in Phases 1–11.
3. **Establishes the spec-first contract discipline.** The OpenAPI spec, the generated-code drift gate, and the hexagonal wire/domain layering Phase 0 introduces set the architectural pattern for every subsequent service or API surface EdgeReco adds.
4. **Produces a shareable artifact.** A clickable demo is the story. It is worth more than any document in convincing reviewers, collaborators, or early adopters that EdgeReco's premise is real.

### Non-motivation

Phase 0 is **not** a pivot away from the committed architecture. The WASM engine, OPFS catalog, service worker, compute worker, and hybrid router remain the north star. Phase 0 is the preface, not a replacement.

---

## 2. Goals

### Primary goal

Ship a clickable demo where:

1. The user opens `apps/demo-web`.
2. The SDK fetches generic candidates from a Python FastAPI backend.
3. The user clicks ~3 items from a single category (e.g., "running").
4. Running / outdoors items visibly rise to the top of the reranked grid.
5. The user reloads the page → the profile persists (IndexedDB) → the reranked order still reflects their past behavior.
6. The API server log shows every click event arriving at `POST /v0/events`.

### Secondary goals

1. **Spec-first OpenAPI** with fully generated client and server stubs on both sides of the contract.
2. **Hexagonal layering** in the Python API service that enforces a type-level wire/domain separation.
3. **TDD discipline** per [`CLAUDE.md`](../../CLAUDE.md) — every SDK module and domain module ships with its test file authored first.
4. **CI from day one** — spec drift gate, generated-code drift gate, TS + Python lint/type/test, Playwright E2E.
5. **A preserved SDK public API** that Phases 1–11 can extend without breaking changes.

---

## 3. Non-goals (explicit)

Phase 0 does **not** include any of the following. Each is listed with the later phase that picks it up.

| Excluded | Owner phase |
|---|---|
| Rust code, `crates/engine/`, WASM compilation | Phase 1 |
| Service Worker, Cache API, offline-first delivery | Phase 2 |
| Manifest-driven CDN artifact distribution | Phase 2 |
| OPFS, SQLite WASM, on-device catalog | Phase 3 |
| Dedicated Compute Worker, main-thread isolation | Phase 4 |
| Hybrid Router fallback, kill switch, capability tiers | Phases 5+ |
| Backend-trained ranker, embeddings, vector retrieval | North star |
| Multi-tenancy, SDK key provisioning | North star |
| Telemetry, observability dashboards | Phase 11 |
| Cross-device profile sync | Never (violates the privacy-first premise) |

Anything not in this table either belongs to a later phase on the arc or is genuinely cut from the vision.

---

## 4. Phase arc to north star

Phase 0 is the first step of a coherent arc. Each subsequent phase replaces exactly one Phase 0 stub with the real implementation, behind an interface that was already shipped.

```
Phase 0 — Proof of Loop                     [this spec]
  └─ JS reranker, React demo, FastAPI, spec-first OpenAPI, IDB profile

Phase 1 — WASM scorer drop-in
  └─ Replace JS reranker with Rust → WASM, same Scorer interface

Phase 2 — Offline layer
  └─ Service Worker, manifest-driven CDN artifacts, Cache API

Phase 3 — On-device catalog
  └─ SQLite WASM in OPFS, replaces GET /v0/catalog

Phase 4 — Compute worker
  └─ Move WASM scorer into dedicated Worker, unblock main thread

Phase 5+ — Hybrid Router hardening, kill switch, telemetry
  └─ Existing MVP_ROADMAP Phases 7–11

North star: EdgeReco as documented in PRD / ARCHITECTURE / TECH_SPEC
```

### The load-bearing invariant

The SDK public API frozen in Phase 0 is the same surface Phase 1+ consumes. Concretely:

```ts
// This is the shape every future phase must preserve.
createEdgeRecoSdk({ apiBaseUrl }): EdgeRecoSdk
sdk.init(): Promise<void>
sdk.trackImpression({ itemId, contextType }): void
sdk.trackClick({ itemId, contextType }): void
sdk.trackFavorite({ itemId, contextType }): void
sdk.getCandidates(req): Promise<RankedResponse>
sdk.getProfile(): ProfileSnapshot
sdk.resetProfile(): Promise<void>
```

Behind each method, implementations may change:

| Method | Phase 0 impl | Phase 1+ impl |
|---|---|---|
| `getCandidates` | fetch candidates → JS reranker | fetch candidates → WASM reranker (Phase 1) → Compute Worker (Phase 4) |
| `init` | load profile from IDB | load from IDB + prefetch manifest (Phase 2) + warm WASM (Phase 4) |
| `trackClick` | update IDB profile + fire-and-forget `/v0/events` | same, plus queue/batch (Phase 10), plus sampling (Phase 10) |

Call sites in `apps/demo-web` and future integrator code never change.

---

## 5. Architecture

### Component map

```
┌───────────────────────────────────┐
│  apps/demo-web (Vite + React)    │  calls SDK surface only
│                                   │
│   ProfilePanel ─── CandidateGrid │
└─────────────┬─────────────────────┘
              │
              ▼
┌───────────────────────────────────┐
│  packages/sdk                     │  framework-agnostic TS
│                                   │
│   tracker  profile-store          │
│    │           │                  │
│    ▼           ▼                  │
│   reranker ◄─ storage (IDB)       │
│    ▲                              │
│    │                              │
│   candidate-client                │
│    │  uses generated/api-client   │
└────┼──────────────────────────────┘
     │ HTTP (generated from openapi.yaml)
     ▼
┌───────────────────────────────────┐
│  services/api (Python FastAPI)    │
│                                   │
│   generated/routes  ── wire ──    │
│                          │        │
│                          ▼        │
│                       domain      │
│                    catalog.py     │
│                    types.py       │
└───────────────────────────────────┘
              ▲
              │ loads on startup
              ▼
┌───────────────────────────────────┐
│  data/catalog.json                │
└───────────────────────────────────┘
```

### Single source of truth for the wire contract

`packages/contracts/openapi.yaml` is the **only** hand-authored description of the API surface. Everything else on the wire — Pydantic models, FastAPI route stubs, TypeScript types, the TS HTTP client — is generated from it. The generated output is committed to git and verified by a CI drift gate.

### Hexagonal wire/domain separation

The Python API service enforces a type-level split:

- **Wire types** live in `services/api/app/generated/models.py` (Pydantic, auto-generated, never hand-edited).
- **Domain types** live in `services/api/app/domain/types.py` (plain `@dataclass(frozen=True)`, no Pydantic, no FastAPI imports).
- **The only place they meet** is `services/api/app/wire/handlers.py`, which translates wire → domain on input and domain → wire on output.

This makes it impossible to accidentally reuse a wire model in business logic, which is the main architectural benefit of spec-first generated stubs over hand-written Pydantic.

---

## 6. Monorepo layout (additions to existing)

Only directories marked **NEW** are created in Phase 0. WASM-era directories (`packages/service-worker/`, `packages/compute-worker/`, `crates/engine/`) are left for the phases that need them.

```
packages/
  contracts/                        # NEW — OpenAPI spec + codegen scripts
    openapi.yaml
    scripts/generate-python.sh
    scripts/generate-typescript.sh
    package.json
  sdk/                              # existing — Phase 0 fills it in
    src/
      generated/                    # auto-generated from openapi.yaml
        api-types.ts
        api-client.ts
      lib/
        tracker.ts
        profile-store.ts
        reranker.ts
        storage.ts                  # thin IDB wrapper
        candidate-client.ts
      index.ts                      # createEdgeRecoSdk() factory
      types.ts                      # SDK-local types (NOT wire types)
    package.json
    vitest.config.ts
  shared/                           # existing — unchanged at Phase 0
services/
  api/                              # NEW — Python FastAPI service
    app/
      generated/                    # auto-generated from openapi.yaml
        __init__.py
        models.py                   # Pydantic wire models
        routes.py                   # FastAPI route stubs (typed)
      wire/
        __init__.py
        handlers.py                 # wire ↔ domain adapter
      domain/
        __init__.py
        catalog.py                  # candidate retrieval logic
        types.py                    # plain @dataclass, NO Pydantic
      main.py                       # FastAPI app wiring
      __init__.py
    tests/
      test_domain_catalog.py
      test_wire_handlers.py
      test_routes_integration.py
    pyproject.toml
    uv.lock
    ruff.toml
apps/
  demo-web/                         # NEW — Vite + React
    src/
      App.tsx
      components/
        CandidateGrid.tsx
        ProfilePanel.tsx
        ScoreBreakdown.tsx
      main.tsx
    index.html
    vite.config.ts
    package.json
  demo-web-e2e/                     # NEW — Playwright
    tests/
      flywheel.spec.ts
    playwright.config.ts
    package.json
data/
  catalog.json                      # NEW — seed catalog (~30 items)
docs/
  specs/
    phase-0-proof-of-loop.md        # this document
  plans/
    phase-0-proof-of-loop.md        # implementation plan (written next)
  MVP_ROADMAP.md                    # updated: adds Phase 0 section at top
.github/
  workflows/
    ci.yml                          # NEW — spec drift, TS, Python, E2E gates
```

---

## 7. OpenAPI contract shape

All endpoints live under `/v0/` so that Phase 1+ can add `/v1/` without breaking Phase 0 clients.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v0/candidates` | Fetch generic candidates for a context |
| `POST` | `/v0/events` | Fire-and-forget event ingestion (returns `202 Accepted`) |
| `GET`  | `/v0/catalog` | Full catalog (replaced in Phase 3 by on-device SQLite) |
| `GET`  | `/v0/healthz` | Liveness probe |

### Schemas (wire types, generated on both sides)

```yaml
CatalogItem:
  id: string
  title: string
  category: string
  tags: string[]
  popularityScore: number     # [0, 1]
  freshnessScore: number      # [0, 1]

CandidateRequest:
  contextType: string         # e.g. "homepage"
  categoryHint?: string       # optional filter hint
  limit: integer              # server caps to a sane max

CandidateResponse:
  items: CatalogItem[]

Event:
  eventId: string             # client-generated UUID
  eventType: "impression" | "click" | "favorite"
  itemId: string
  timestamp: string           # RFC3339
  contextType: string

EventBatch:
  events: Event[]

CatalogResponse:
  items: CatalogItem[]
  generatedAt: string         # RFC3339
```

### Contract discipline

- PR reviews treat `openapi.yaml` as a contract change, not an implementation detail.
- `packages/sdk/src/generated/*` and `services/api/app/generated/*` are regenerated by CI. Hand edits are caught by the drift gate.
- Domain types in `services/api/app/domain/types.py` **must not** import from `generated/` or contain Pydantic.

---

## 8. SDK components

`packages/sdk` is framework-agnostic TypeScript. Zero React/Vue/Svelte dependencies — the demo app imports it as a plain library. This also proves, by construction, that the SDK is integrator-neutral.

### Public API

```ts
interface EdgeRecoSdkOptions {
  apiBaseUrl: string;
}

interface TrackOptions {
  itemId: string;
  contextType: string;
}

interface CandidateQuery {
  contextType: string;
  categoryHint?: string;
  limit: number;
}

interface RankedItem extends CatalogItem {
  finalScore: number;
  scoreBreakdown: {
    popularity: number;
    categoryMatch: number;
    tagMatch: number;
    freshness: number;
    repetitionPenalty: number;
  };
}

interface RankedResponse {
  items: RankedItem[];
  rawItems: CatalogItem[];   // pre-rerank, for demo/debug use
}

interface ProfileSnapshot {
  categoryAffinity: Readonly<Record<string, number>>;
  tagAffinity: Readonly<Record<string, number>>;
  recentlyViewed: ReadonlyArray<string>;
  sessionClickCount: number;
}

interface EdgeRecoSdk {
  init(): Promise<void>;
  trackImpression(opts: TrackOptions): void;
  trackClick(opts: TrackOptions): void;
  trackFavorite(opts: TrackOptions): void;
  getCandidates(query: CandidateQuery): Promise<RankedResponse>;
  getProfile(): ProfileSnapshot;
  resetProfile(): Promise<void>;
}

export function createEdgeRecoSdk(opts: EdgeRecoSdkOptions): EdgeRecoSdk;
```

### Modules

- **`tracker.ts`** — Event capture façade. On `click` / `favorite` it calls `profileStore.update(event)`. On every event it enqueues a fire-and-forget POST to `/v0/events`.
- **`profile-store.ts`** — In-memory profile with write-through to IDB. Exposes `update(event)`, `snapshot()`, `reset()`. Every mutation persists synchronously to IDB via `storage.ts`.
- **`storage.ts`** — Thin IndexedDB wrapper. Single database `edgereco`, single object store `profile`, single key `singleton`. Phase 1+ can widen this without breaking consumers.
- **`candidate-client.ts`** — Wraps the generated `api-client.ts`. Adds a timeout, a single retry on transient failure, and fire-and-forget event posting (errors logged, not thrown).
- **`reranker.ts`** — **Pure function.** `rerank(candidates, profile) → RankedResponse`. Deterministic, trivially unit-testable.
- **`index.ts`** — `createEdgeRecoSdk(opts)` factory wiring the modules together.

### Scoring formula (explicit)

```
score(item, profile) =
    0.50 * item.popularityScore
  + 0.25 * categoryMatch(item, profile)
  + 0.15 * tagMatch(item, profile)
  + 0.10 * item.freshnessScore
  -        repetitionPenalty(item, profile)

categoryMatch      = profile.categoryAffinity[item.category] ?? 0              ∈ [0, 1]
tagMatch           = mean(profile.tagAffinity[tag] ?? 0 for tag in item.tags)  ∈ [0, 1]
repetitionPenalty  = 0.30 if item.id ∈ profile.recentlyViewed else 0.00
```

### Profile update rules

| Event | Effect on `categoryAffinity[item.category]` | Effect on `tagAffinity[tag]` | Effect on `recentlyViewed` |
|---|---|---|---|
| `impression` | none | none | none |
| `click` | `min(1.0, prev + 0.10)` | `min(1.0, prev + 0.05)` each | prepend `item.id`, cap at 20 |
| `favorite` | `min(1.0, prev + 0.20)` | `min(1.0, prev + 0.05)` each | prepend `item.id`, cap at 20 |

All bump / penalty magnitudes are tunable constants in a single `SCORING_CONSTANTS` object so Phase 1+ can experiment without scattering edits.

---

## 9. API service components

### Layering

```
┌──────────────────────────────────────────────────────┐
│  services/api/app/main.py                            │
│    FastAPI() → includes generated/routes.py          │
└────────────────┬─────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────┐
│  generated/routes.py      generated/models.py        │
│    (from openapi.yaml)      (from openapi.yaml)      │
│  ─ never hand-edited ─    ─ never hand-edited ─      │
└────────────────┬─────────────────────────────────────┘
                 │ route body delegates to handler
                 ▼
┌──────────────────────────────────────────────────────┐
│  wire/handlers.py                                    │
│    - receives wire models (Pydantic)                 │
│    - translates → domain types                       │
│    - calls domain.catalog.filter_candidates          │
│    - translates domain → wire models                 │
│    - returns wire response                           │
└────────────────┬─────────────────────────────────────┘
                 │ pure domain calls
                 ▼
┌──────────────────────────────────────────────────────┐
│  domain/catalog.py   domain/types.py                 │
│    - plain @dataclass(frozen=True)                   │
│    - NO Pydantic, NO FastAPI imports                 │
│    - unit-testable with zero HTTP setup              │
└──────────────────────────────────────────────────────┘
```

### Domain logic

At Phase 0, `filter_candidates` is deliberately trivial:

```python
def filter_candidates(
    catalog: Sequence[DomainItem],
    context: DomainCandidateContext,
) -> list[DomainItem]:
    filtered = (
        [i for i in catalog if i.category == context.category_hint]
        if context.category_hint
        else list(catalog)
    )
    filtered.sort(key=lambda i: i.popularity_score, reverse=True)
    return filtered[: context.limit]
```

No personalization on the server. No embeddings. No learned ranker. Roughly fifteen lines of domain code, a test file three times its size, and a clean seam for Phase 1+ to plug in richer retrieval without touching `wire/` or the OpenAPI schema.

### Event ingestion

`POST /v0/events` logs the batch to stdout (via `structlog`) and returns `202 Accepted`. Events are **not** persisted at Phase 0 — the endpoint's purpose is to prove the contract. Persistence arrives in Phase 10 alongside the rest of the Event Uplink pipeline from the existing MVP roadmap.

### Catalog loading

`services/api/app/main.py` loads `data/catalog.json` once at startup into an in-memory list of `DomainItem`. Refresh is out of scope for Phase 0.

---

## 10. Demo app

`apps/demo-web` is a minimal Vite + React app. Its entire purpose is to make the flywheel visible to a human reviewer.

### Layout

```
┌────────────────────────────────────────────────────────────┐
│  EdgeReco — Phase 0 Demo                                   │
├────────────────────────┬───────────────────────────────────┤
│                        │                                   │
│   Candidate Grid       │   Profile Panel                   │
│                        │                                   │
│   [item][item][item]   │   Category affinity:              │
│   [item][item][item]   │     running      ████░░  0.70    │
│   [item][item][item]   │     outdoors     ██░░░░  0.30    │
│                        │     formal       ░░░░░░  0.00    │
│   (click to favor)     │                                   │
│                        │   Tags: lightweight, waterproof   │
│                        │   Recently: item_12, item_77      │
│                        │                                   │
│                        │   [Reset profile]                 │
└────────────────────────┴───────────────────────────────────┘
```

### Behavior

1. On mount, calls `sdk.init()` → `sdk.getCandidates({ contextType: "homepage", limit: 30 })`.
2. Renders the reranked grid. Each card shows title, category, tags, and a collapsible score breakdown.
3. Clicking a card fires `sdk.trackClick({ itemId, contextType: "homepage" })`, then refetches + reranks.
4. The Profile Panel subscribes to the SDK profile snapshot and re-renders on change.
5. Reset button calls `sdk.resetProfile()` and refetches.

React is used **only** inside `apps/demo-web`. `packages/sdk` remains framework-agnostic and imports zero React symbols.

---

## 11. Testing strategy

| Layer | Tool | What it proves |
|---|---|---|
| SDK unit | `vitest` | Reranker is deterministic and matches the formula. Profile store applies bumps and penalties correctly. Storage wrapper round-trips through a fake IDB. Tracker routes events to the right sinks. |
| API unit | `pytest` | `filter_candidates` returns the correct subset/order. Wire↔domain translation is lossless. |
| API integration | `pytest` + `httpx.TestClient` | End-to-end request/response against a mounted FastAPI app. Asserts that responses conform to the committed OpenAPI schema. |
| Cross-language contract | `vitest` + spawned `uvicorn` subprocess | SDK talks to a real FastAPI process. Asserts that a known `catalog.json` + a fixed click sequence produces a specific reranked order. |
| E2E | Playwright (`apps/demo-web-e2e`) | One flywheel test: load demo → read the pre-click ordering → click three "running" items → assert running items occupy the top positions → reload → assert same ordering (profile persisted). |

### TDD discipline

Per [`CLAUDE.md`](../../CLAUDE.md):

- Every SDK module ships with its test file authored **before** implementation.
- The reranker is the anchor test: the scoring formula is encoded in the test first, and the implementation follows until the test passes.
- Every domain module in `services/api/app/domain/` ships with its test file authored first.

### What we are explicitly **not** testing at Phase 0

- Performance (no cold-start or warm-inference budgets — those are Phase 11 hardening criteria).
- Offline behavior (no Service Worker at Phase 0).
- Kill-switch / fallback routing (no Hybrid Router at Phase 0).
- WASM engine behavior (no engine at Phase 0).

---

## 12. CI gates

`.github/workflows/ci.yml` runs on every PR:

1. **Generated-code drift** — `pnpm -C packages/contracts generate`, then `git diff --exit-code packages/sdk/src/generated services/api/app/generated`. Fails if any generated file drifted from the committed one.
2. **TypeScript** — `biome check .`, `tsc --noEmit` across workspace, `vitest run` across workspace.
3. **Python** — `uv sync`, `ruff check services/api`, `mypy services/api`, `pytest services/api`.
4. **E2E** — spin up `services/api` and `apps/demo-web` concurrently, run `playwright test` against them, tear down.

The drift gate is what makes spec-first real. Without it, generators are suggestions.

---

## 13. Tooling

| Layer | Tool |
|---|---|
| TS package manager | `pnpm` (already committed via [`CLAUDE.md`](../../CLAUDE.md)) |
| TS lint + format | `biome` |
| TS type check | `tsc --noEmit` |
| TS test runner | `vitest` |
| Python package manager | `uv` |
| Python lint + format | `ruff` |
| Python type check | `mypy` (strict mode on `services/api/app/domain`) |
| Python test runner | `pytest` + `httpx.TestClient` |
| OpenAPI → TS types | `openapi-typescript` |
| OpenAPI → TS client | `openapi-fetch` |
| OpenAPI → Pydantic models | `datamodel-code-generator` |
| OpenAPI → FastAPI routes | `fastapi-code-generator` |
| Web framework | `fastapi` |
| E2E | `playwright` (TS) |
| CI | GitHub Actions |

---

## 14. Acceptance criteria

Phase 0 is done when **all** of these hold on a clean checkout:

1. `pnpm install && pnpm generate && pnpm -r test && pnpm -r build && pnpm e2e` runs green.
2. `pnpm dev` spins up `services/api` on port `:8000` and `apps/demo-web` on port `:5173`.
3. The demo shows a grid of ~30 items returned by the API.
4. Clicking three "running" items and reloading shows running items occupying the top positions of the reranked grid.
5. `services/api` logs show click events arriving at `POST /v0/events`.
6. The Playwright flywheel test passes.
7. `docs/specs/phase-0-proof-of-loop.md` (this file) and `docs/plans/phase-0-proof-of-loop.md` exist and accurately describe what was built.
8. `docs/MVP_ROADMAP.md` has a Phase 0 section at the top that links to this spec and its companion plan.
9. The CI workflow passes on the PR that lands Phase 0.

---

## 15. Open questions & deferred decisions

None blocking Phase 0. For the record, items we decided to defer until we have working Phase 0 code:

- **Time-decay on affinities.** Currently affinities monotonically increase toward 1.0. A decay factor (e.g., halve every N clicks on other categories) makes the profile more responsive but adds tuning surface. Deferred.
- **Negative signals.** Hiding, downvoting, or "not interested" events would generate negative affinity bumps. Deferred to Phase 1+.
- **Per-user randomization / exploration.** Currently deterministic. Adding ε-greedy exploration is a natural Phase 1+ addition.
- **Structured logging / OpenTelemetry.** Phase 0 uses `structlog` with stdout output. Real observability is Phase 11.

---

## 16. References

- [`PRD.md`](../PRD.md) — product goals and the long-term value proposition that Phase 0 validates in miniature.
- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — long-term component design. Phase 0 stubs every component that requires WASM / OPFS / service worker.
- [`TECH_SPEC.md`](../TECH_SPEC.md) — long-term API, storage, and event contracts. Phase 0's OpenAPI schemas are a simplified subset.
- [`MVP_ROADMAP.md`](../MVP_ROADMAP.md) — original 11-phase TDD roadmap. Phase 0 prepends to this.
- [`CLAUDE.md`](../../CLAUDE.md) — conventions, TDD discipline, code quality standards.
