# EdgeReco — Product Requirements Document

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Draft |
| **Last Updated** | 2026-02-28 |
| **Companion Docs** | [Architecture](ARCHITECTURE.md) · [Technical Specification](TECH_SPEC.md) |

---

## 1. Executive Summary

EdgeReco moves recommendation inference from backend servers to the user's browser. A WebAssembly-compiled engine, fed by CDN-distributed product catalogs and model artifacts, generates personalized recommendations locally — achieving sub-10ms latency, offline capability, and 80%+ reduction in backend recommendation calls. Interaction events flow back to the data pipeline to close the personalization loop without exposing individual user data.

---

## 2. Problem Statement

### Current State

Traditional recommendation systems rely on synchronous backend API calls for every recommendation request. This creates:

- **Latency overhead** — Network round-trips add 100-500ms per recommendation request, degrading user experience on product pages, search results, and checkout flows.
- **Backend load concentration** — Recommendation services are among the most called and most expensive backend endpoints, scaling linearly with traffic.
- **Offline blindness** — Users on unreliable connections (commuters, rural areas, mobile networks) receive no recommendations, losing personalization entirely.
- **Privacy friction** — Personalization requires sending behavioral signals to servers, creating data residency and consent management complexity under GDPR/CCPA.
- **Experimentation bottlenecks** — Deploying a new recommendation model requires backend rollout, load testing, and gradual canary — a multi-day process that limits experimentation velocity.

### Opportunity

Modern browsers provide the primitives needed to run inference locally: WebAssembly for compute, OPFS/IndexedDB for storage, Service Workers for background sync, and Cache API for artifact management. A CDN-first architecture can distribute model artifacts as static files, making deployment as fast and cheap as a cache invalidation.

---

## 3. Goals

### Primary Goals

| ID | Goal | Target |
|----|------|--------|
| G1 | Reduce backend recommendation API calls | ≥ 80% reduction |
| G2 | Local recommendation latency | < 10ms (p95, warm state) |
| G3 | Offline recommendation capability | Full recommendations with cached data |
| G4 | Cold-start to first local recommendation | < 3 seconds |

### Secondary Goals

| ID | Goal | Rationale |
|----|------|-----------|
| G5 | Rapid model experimentation | New engine versions deploy via CDN manifest, no backend rollout |
| G6 | Infrastructure cost reduction | Shift compute to client devices, reduce server fleet |
| G7 | Mobile SDK foundation | Shared artifact format enables native mobile integration via `IRecoRuntime` |
| G8 | Privacy-by-design personalization | All behavioral data stays on-device by default |

---

## 4. Non-Goals

| ID | Explicitly Out of Scope | Rationale |
|----|------------------------|-----------|
| NG1 | Replace the model training pipeline | EdgeReco consumes trained artifacts; training remains server-side |
| NG2 | Serve as authoritative product inventory | The catalog is a read-only, eventually-consistent projection for scoring; source of truth remains the commerce platform |
| NG3 | General-purpose edge compute platform | The system is purpose-built for recommendations; not a generic WASM runtime |
| NG4 | IoT or embedded device support | Browser and mobile SDK only; no plans for constrained IoT environments |
| NG5 | Real-time collaborative filtering | Local inference uses pre-computed models; real-time collaborative signals remain server-side |

---

## 5. User Stories

### End Users

| ID | Story | Acceptance Criteria |
|----|-------|--------------------|
| US1 | As a shopper, I want to see personalized recommendations instantly when I open a product page, so I don't wait for loading spinners. | Recommendations render within the page's LCP budget (< 2.5s cold, < 100ms warm). |
| US2 | As a commuter shopping on a spotty connection, I want recommendations to work even when my network drops, so I can continue browsing. | When offline, cached catalog + engine produce recommendations without error states. |
| US3 | As a privacy-conscious user, I want my browsing behavior to stay on my device, so I feel safe interacting with recommendations. | No PII or raw behavioral events leave the browser. Only anonymous, aggregated interaction signals are transmitted. |

### Merchandisers

| ID | Story | Acceptance Criteria |
|----|-------|--------------------|
| US4 | As a merchandiser, I want to deploy a new recommendation strategy to 5% of users within an hour, so I can test promotions quickly. | Manifest update with canary percentage propagates via CDN within TTL window; canary users activate new engine. |
| US5 | As a merchandiser, I want an emergency kill switch to disable edge recommendations instantly if results look wrong. | Kill switch flag in manifest forces immediate fallback to backend. Propagation ≤ CDN TTL (typically < 60s with stale-while-revalidate). |

### Engineers

| ID | Story | Acceptance Criteria |
|----|-------|--------------------|
| US6 | As a platform engineer, I want to monitor edge recommendation health across the fleet, so I can detect regressions before they impact business metrics. | Client-side observability events (latency histograms, error rates, engine versions) are collected and available in the monitoring dashboard. |
| US7 | As an ML engineer, I want to ship a new WASM engine version without coordinating a backend deploy, so I can iterate faster. | Engine artifact published to CDN + manifest version bump triggers client-side hot-swap with smoke test. |
| US8 | As a frontend engineer, I want a simple SDK API (`getRecommendations`) that abstracts whether the result came from local inference or backend fallback. | Single API call returns `RecoResponse` with `source` field indicating origin. No caller-side branching needed. |

---

## 6. Success Metrics

### Latency KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Local recommendation latency (p50) | < 5ms | Client-side performance marks |
| Local recommendation latency (p95) | < 10ms | Client-side performance marks |
| Cold-start time (first recommendation) | < 3s | Time from SDK init to first result |
| Warm-start time | < 50ms | Time from page load (cached state) to ready |

### Reliability KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Local recommendation success rate | ≥ 95% | Successful local results / total requests |
| Graceful fallback rate | 100% | Backend fallback on local failure |
| Engine hot-swap success rate | ≥ 99% | Successful upgrades / total upgrade attempts |
| Offline availability | 100% (with cached data) | Recommendations served when navigator.onLine === false |

### Business KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Backend reco API call reduction | ≥ 80% | Server-side call volume comparison |
| Recommendation CTR | ≥ parity with server-side | A/B test during rollout |
| Revenue per session (reco-influenced) | ≥ parity with server-side | A/B test during rollout |

### Operational KPIs

| Metric | Target | Measurement |
|--------|--------|-------------|
| Engine deploy time (publish → 50% adoption) | < 1 hour | CDN propagation + TTL + client poll |
| Artifact CDN hit rate | ≥ 99% | CDN analytics |
| Client storage usage | < 50MB typical | Client-side quota monitoring |

---

## 7. User Journeys

### 7.1 Cold Start (First Visit)

1. User lands on site for the first time.
2. Main page loads; SDK initializes, registers Service Worker.
3. Service Worker fetches manifest from CDN.
4. Manifest triggers parallel download of WASM engine, catalog snapshot, and config.
5. Artifacts cache in Cache API and OPFS.
6. Compute Worker boots, loads WASM engine and catalog.
7. First recommendation request routes through Hybrid Router.
   - If local engine is ready → local result (target: < 3s from page load).
   - If still loading → transparent backend fallback.
8. Subsequent requests on same page use local engine (< 10ms).

### 7.2 Warm Start (Return Visit)

1. User returns to site.
2. SDK initializes; Service Worker is already registered and active.
3. Cached artifacts are available immediately.
4. Compute Worker boots with cached WASM engine and catalog.
5. Service Worker checks manifest for updates in background.
6. First recommendation served locally within 50ms of SDK ready.
7. If manifest indicates updates, delta patches download in background without interrupting current session.

### 7.3 Engine Update (Hot-Swap)

1. ML team publishes new WASM engine to CDN, updates manifest version.
2. Service Worker's periodic manifest check detects new engine version.
3. New engine artifact downloads in background.
4. Compute Worker loads new engine in shadow mode, runs smoke test (predefined query → expected result shape).
5. Smoke test passes → new engine becomes active; old engine evicted.
6. Smoke test fails → new engine discarded, old engine continues, error event reported.
7. Manifest supports canary: only N% of clients receive the new version initially.

### 7.4 Degraded / Fallback

1. Any local failure (WASM crash, corrupt catalog, storage quota exceeded) triggers fallback.
2. Hybrid Router detects failure, routes request to backend API.
3. Error event queued for uplink.
4. On next manifest check, Service Worker may re-download corrupted artifacts.
5. If kill switch is active in manifest, all requests route to backend immediately — no local inference attempted.

---

## 8. Constraints & Assumptions

### Browser Constraints

| Constraint | Detail |
|------------|--------|
| Storage quota | OPFS + IDB typically limited to origin-proportional quota (varies by browser); target < 50MB typical usage |
| WASM memory | Linear memory capped at practical limit; target < 128MB peak |
| Worker threads | Dedicated Worker for compute; Service Worker for sync. No SharedArrayBuffer requirement. |
| Browser targets | Chromium 90+, Firefox 100+, Safari 16.4+ (OPFS support) |

### Assumptions

- CDN is highly available (≥ 99.9%) and supports `stale-while-revalidate` caching.
- Product catalogs for recommendation scoring are < 10MB gzipped for typical deployments.
- WASM engine binary is < 2MB gzipped.
- Users visit the site at least once before expecting offline capability.
- Backend fallback API remains available as a safety net during the rollout period and beyond.

---

## 9. Privacy & Compliance

### Local-Only Personalization

All user interaction signals (clicks, views, cart adds) are stored exclusively in browser-local storage (IndexedDB). The recommendation engine reads these signals locally to personalize results. No raw behavioral data leaves the browser.

### Event Uplink

The event uplink pipeline transmits **anonymous, aggregated interaction signals** (e.g., "recommendation X was clicked in context Y") using a first-party anonymous device ID. Events are:

- Stripped of any PII before transmission.
- Batched and sent via `sendBeacon` or `fetch` to a first-party endpoint.
- Subject to sampling (not all events are transmitted).

### GDPR / CCPA Alignment

| Principle | Implementation |
|-----------|----------------|
| Data minimization | Only recommendation-relevant signals stored locally; no cross-site tracking |
| Right to erasure | `EdgeReco.destroy()` wipes all local storage (OPFS, IDB, Cache API entries) |
| Consent | Event uplink respects the site's consent management platform; if consent is denied, no events leave the browser |
| Anonymity | Device ID is random, per-origin, not linked to authenticated identity unless user explicitly logs in and site opts into merge |

### Anonymous Identity

- A random anonymous ID is generated per-origin on first visit.
- If a user logs in, the site may call the SDK to associate the anonymous ID with an authenticated identity for server-side profile merging.
- The SDK never initiates cross-device or cross-site identity linking on its own.

---

## 10. Rollout Strategy

### Phase 0 — Shadow Mode (Internal)

- Deploy full client stack to internal/staging environments.
- Hybrid Router sends requests to **both** local engine and backend; only backend result shown to user.
- Compare local vs. backend results for quality parity.
- **Kill switch available.**

### Phase 1 — Canary (1-5% Production Traffic)

- Manifest canary flag directs a small percentage of real users to local inference.
- Monitor latency, error rates, CTR, and revenue metrics against control group.
- **Kill switch available.** Instant rollback to 0% canary via manifest update.

### Phase 2 — Controlled Rollout (5-50%)

- Gradually increase canary percentage based on Phase 1 results.
- Introduce delta-sync catalogs and engine hot-swap in production.
- Validate storage quota behavior across browser populations.
- **Kill switch available.**

### Phase 3 — General Availability (50-100%)

- Local inference becomes the default path.
- Backend fallback remains permanently for failure cases, unsupported browsers, and kill-switch scenarios.
- Offline mode enabled by default.
- **Kill switch available** — always.

---

## 11. Open Questions & Risks

| ID | Item | Type | Status |
|----|------|------|--------|
| OQ1 | What is the minimum viable catalog size for useful recommendations? | Open Question | Pending analysis |
| OQ2 | Should the WASM engine support multiple recommendation algorithms simultaneously? | Open Question | Pending decision |
| OQ3 | How do we handle users who aggressively clear browser storage? | Open Question | Pending design |
| R1 | Browser vendors change OPFS or WASM APIs in breaking ways | Risk | Mitigated by abstraction layer + fallback |
| R2 | Catalog size exceeds practical storage limits for large retailers | Risk | Mitigated by catalog segmentation strategy (TBD) |
| R3 | WASM cold-start exceeds 3s budget on low-end devices | Risk | Mitigated by backend fallback + progressive enhancement |
| R4 | CDN cache poisoning delivers malicious WASM binary | Risk | Mitigated by content-addressed URLs + integrity verification |
| R5 | Users on Safari < 16.4 have no OPFS support | Risk | Mitigated by IndexedDB fallback path |

---

## 12. Glossary

| Term | Definition |
|------|------------|
| **Artifact** | Any CDN-distributed binary: WASM engine, catalog snapshot, delta patch, or config |
| **Canary** | A controlled rollout where a percentage of clients receive a new artifact version |
| **Catalog** | A read-only product database (SQLite) used for recommendation scoring |
| **Cold start** | First-ever initialization on a device with no cached artifacts |
| **Compute Worker** | A Dedicated Web Worker that hosts the WASM engine and SQLite catalog |
| **Delta patch** | A binary diff applied to an existing catalog to produce an updated version |
| **Flywheel** | The closed loop: local inference → interaction events → model retraining → improved engine → better local inference |
| **Hot-swap** | Replacing the active WASM engine with a new version without page reload |
| **Hybrid Router** | Client-side component that decides whether to route a recommendation request locally or to the backend |
| **Kill switch** | A manifest flag that immediately disables local inference and forces backend fallback |
| **Manifest** | A JSON document on CDN describing the current artifact versions, canary rules, and feature flags |
| **OPFS** | Origin Private File System — a browser API providing fast, file-system-like storage |
| **Smoke test** | A predefined query run against a new engine version to verify it produces valid output |
| **Warm start** | Initialization on a device with cached artifacts from a prior session |
