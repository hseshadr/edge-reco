# EdgeReco — Architecture Document

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Draft |
| **Last Updated** | 2026-02-28 |
| **Companion Docs** | [PRD](PRD.md) · [Technical Specification](TECH_SPEC.md) |

---

## 1. System Overview & Design Philosophy

EdgeReco is built on three core principles:

**CDN-first** — All artifacts (WASM engines, catalogs, configs) are static, content-addressed files distributed via CDN. No backend involvement in the hot path. Deploys are cache invalidations, not server rollouts.

**Local-first** — The browser is the primary compute environment for recommendations. The backend exists as a fallback, not the default. Storage, inference, and personalization all happen on-device.

**Flywheel** — Interaction events captured locally feed back into server-side model training. Better models produce better artifacts. Better artifacts produce better local recommendations. Better recommendations produce richer interaction signals.

---

## 2. High-Level Architecture

The system spans four tiers: the Datalake (training), Backend (fallback + event ingestion), CDN (artifact distribution), and Browser (inference + personalization).

![System Context](diagrams/system-context.svg)

---

## 3. Component Breakdown

### Browser Internals

![Browser Internals](diagrams/browser-internals.svg)

### Component Responsibilities

| Component | Thread | Responsibility |
|-----------|--------|----------------|
| **Hybrid Router** | Main | Decides local vs. fallback for each request based on engine readiness, timeout, and kill-switch status |
| **SDK API Layer** | Main | Public API surface (`init`, `getRecommendations`, `reportInteraction`, `destroy`) |
| **Service Worker** | SW | Manifest polling, artifact download/caching, background delta-sync |
| **Manifest Manager** | SW | Parses manifest, determines required artifact updates, handles canary logic |
| **Artifact Cache Controller** | SW | Manages Cache API entries, evicts old versions, validates content-addressed hashes |
| **Background Sync Orchestrator** | SW | Coordinates catalog delta-sync, event batch uplink |
| **WASM Engine** | Compute Worker | Executes recommendation inference: loads model weights, scores items against user context |
| **SQLite WASM** | Compute Worker | Provides SQL query access to the product catalog stored in OPFS |
| **Smoke Test Harness** | Compute Worker | Validates a new engine version before activation |
| **Storage Layer** | — | OPFS for large binaries (catalog, engine), IDB for structured data (state, events, metadata), Cache API for HTTP-cached artifacts |

---

## 4. Data Flows

### 4.1 Artifact Distribution Flow

![Artifact Distribution Flow](diagrams/artifact-distribution-flow.svg)

### 4.2 Recommendation Request Flow

![Recommendation Request Flow](diagrams/recommendation-request-flow.svg)

### 4.3 Event Uplink Flow

![Event Uplink Flow](diagrams/event-uplink-flow.svg)

---

## 5. CDN Strategy

### Artifact Caching Tiers

| Artifact | Cache-Control | Mutability | URL Strategy |
|----------|--------------|------------|-------------|
| Manifest | `max-age=60, stale-while-revalidate=300` | Mutable (pointer to current versions) | Fixed path: `/edgereco/manifest.json` |
| WASM Engine | `max-age=31536000, immutable` | Immutable | Content-addressed: `/edgereco/engines/{sha256}.wasm` |
| Catalog Snapshot | `max-age=31536000, immutable` | Immutable | Content-addressed: `/edgereco/catalogs/{sha256}.db` |
| Delta Patch | `max-age=31536000, immutable` | Immutable | Content-addressed: `/edgereco/deltas/{sha256}.delta` |
| Config | `max-age=31536000, immutable` | Immutable | Content-addressed: `/edgereco/configs/{sha256}.json` |

### Manifest Design (Architectural View)

The manifest is the single mutable pointer in the CDN layer. It tells clients which artifact versions to use:

- **Current versions** — SHA256 hashes for engine, catalog, config
- **Delta chain** — Ordered list of delta patches from known base versions to current catalog
- **Canary rules** — Percentage-based traffic split for A/B engine versions
- **Feature flags** — Kill switch, experimental features
- **Minimum client version** — Forces SDK upgrade if needed

> Full manifest JSON schema is in the [Technical Specification](TECH_SPEC.md#7-manifest-design).

### Cache Invalidation

- Artifacts are immutable and content-addressed — they never need invalidation.
- The manifest is the only resource that changes. Its short TTL (60s) with `stale-while-revalidate` ensures clients converge within minutes of a publish.
- For emergency rollback, publishing a new manifest pointing to previous artifact hashes is sufficient. No artifact deletion needed.

---

## 6. Versioned Engine Hot-Swap

### Lifecycle

1. **Detect** — Service Worker's manifest poll finds a new engine version.
2. **Download** — New WASM binary fetched and cached alongside the current version.
3. **Shadow Load** — Compute Worker instantiates the new engine without deactivating the old one.
4. **Smoke Test** — Predefined queries run against the new engine. Results validated for shape, count, and latency.
5. **Activate** — If smoke test passes, new engine replaces old. Old binary evicted from cache.
6. **Rollback** — If smoke test fails, new engine discarded. Old engine continues. Error event reported.

### Canary Rollout

The manifest can specify two engine versions with a traffic-split percentage:

- Client hashes its anonymous device ID against the canary percentage.
- Deterministic assignment ensures a client stays in the same group across page loads.
- Canary percentage can be updated server-side by publishing a new manifest.

### Rollback Guarantees

- The old engine binary is never evicted until the new engine passes its smoke test.
- If the manifest itself is unreachable, the client continues with the last known good configuration.
- The kill switch in the manifest bypasses local inference entirely — no engine needed.

---

## 7. Identity & Personalization Architecture

### Flywheel Cycle

![Personalization Flywheel](diagrams/personalization-flywheel.svg)

### Two-Level Identity Model

**Level 1 — Anonymous Device ID**
- Generated on first SDK initialization (random UUID, stored in IDB).
- Used for event uplink attribution and canary bucketing.
- Never correlated across origins or devices.

**Level 2 — Authenticated Identity (Optional)**
- If the user logs in, the site can associate the anonymous ID with an authenticated user ID.
- This enables server-side profile merging: behavioral signals from multiple devices can inform future model training.
- The SDK never initiates identity linking — the site explicitly calls the merge API.

### Local State for Personalization

The Compute Worker reads a `user_state` record from IndexedDB containing:

- Recent interactions (bounded circular buffer).
- Category affinity scores (derived locally from interactions).
- Session context (current page type, referral source).

This state feeds into the WASM engine as input features alongside the catalog data. The engine's scoring function combines item features, user state, and model weights to produce ranked recommendations.

> Storage schema details are in the [Technical Specification](TECH_SPEC.md#5-storage-layer).

---

## 8. Failure Handling & Resilience

### Failure Taxonomy

| Category | Examples |
|----------|---------|
| **Artifact failures** | Manifest fetch fails, WASM download corrupt, delta patch mismatched base |
| **Runtime failures** | WASM trap/crash, SQLite query error, Worker unresponsive |
| **Storage failures** | Quota exceeded, OPFS unavailable, IDB blocked |
| **Network failures** | Offline, CDN unreachable, backend unreachable |

### Response Matrix

| Failure | Immediate Response | Recovery |
|---------|-------------------|----------|
| Manifest fetch fails | Use cached manifest | Retry on next poll interval |
| WASM download corrupt (hash mismatch) | Discard, keep current engine | Retry on next poll |
| Smoke test fails | Discard new engine, keep current | Report error event, retry on next manifest version |
| WASM runtime crash | Route to backend fallback | Restart Compute Worker, reload engine |
| SQLite query error | Route to backend fallback | Re-download catalog on next sync |
| Quota exceeded | Evict oldest artifacts, degrade gracefully | Reduce catalog scope in future syncs |
| Offline | Serve from cached artifacts | Resume sync when online |
| Backend fallback unreachable | Return degraded results (popular items from cached catalog) | Retry backend on next request |

### Degradation Ladder

The system degrades gracefully through these levels:

1. **Full local** — WASM engine + fresh catalog + full personalization. *(Ideal state)*
2. **Stale local** — WASM engine + stale catalog. *(Manifest unreachable, but cached data available)*
3. **Backend fallback** — Server-side recommendations. *(Local engine unavailable)*
4. **Degraded fallback** — Popular items from cached catalog. *(Both engine and backend unavailable)*
5. **No recommendations** — Empty state. *(No cached data, no network)*

Each level is a designed state, not an error. The Hybrid Router selects the highest available level and reports the current level via observability events.

### Kill Switch

The manifest contains a `kill_switch` boolean. When `true`:

- The Hybrid Router immediately stops routing to the local engine.
- All requests go to backend fallback.
- The Compute Worker is not started.
- This propagates within CDN TTL (~60s typical).

---

## 9. Observability

### Client-Side Metrics

| Metric | Type | Description |
|--------|------|-------------|
| `reco.latency` | Histogram | Time from request to response (labeled by source) |
| `reco.source` | Counter | Requests by source: `local`, `backend`, `degraded` |
| `reco.error` | Counter | Errors by type and component |
| `engine.version` | Gauge | Currently active engine version hash |
| `engine.swap` | Counter | Engine hot-swap attempts (labeled: `success`, `smoke_fail`, `download_fail`) |
| `catalog.version` | Gauge | Current catalog version hash |
| `catalog.sync` | Counter | Sync operations (labeled: `snapshot`, `delta`, `fail`) |
| `storage.usage` | Gauge | Bytes used in OPFS + IDB |
| `event.uplink` | Counter | Events sent (labeled: `success`, `fail`, `sampled_out`) |

### Collection

- Events batched and sent via the same event uplink pipeline.
- Sampling applied to high-frequency metrics (latency histograms).
- Critical metrics (errors, engine swaps) always reported.

### Alerting Triggers

| Trigger | Condition | Severity |
|---------|-----------|----------|
| Local success rate drop | < 90% over 15-minute window | P1 |
| Engine swap failure spike | > 5% failure rate in 1 hour | P2 |
| Catalog sync stale | No successful sync in 24 hours (fleet-wide) | P2 |
| Storage quota warnings | > 10% of clients reporting quota exceeded | P3 |

---

## 10. Security Model

### Artifact Integrity

- All artifacts use **content-addressed URLs**: the URL contains the SHA256 hash of the content.
- The Service Worker verifies the downloaded artifact's hash against the URL before caching.
- A hash mismatch causes the artifact to be discarded and an error event reported.
- The manifest itself is fetched over HTTPS from a first-party origin.

### Data at Rest

- OPFS and IndexedDB data is scoped to the origin and protected by the browser's same-origin policy.
- No encryption at rest beyond what the browser/OS provides (the data is not sensitive — it's product catalog data and anonymous interaction signals).
- The `destroy()` API wipes all stored data for the origin.

### Data in Transit

- All CDN fetches use HTTPS.
- Event uplink uses HTTPS to a first-party endpoint.
- No third-party endpoints are contacted by the SDK.

### Threat Model Summary

| Threat | Mitigation |
|--------|-----------|
| CDN compromise / cache poisoning | Content-addressed URLs + hash verification |
| Malicious WASM execution | Browser sandbox (WASM runs in Worker, no DOM access, no network access) |
| Local storage tampering | Treated as untrusted; engine validates input shapes; corrupt state triggers re-sync |
| Event data interception | HTTPS + first-party endpoints only |
| Cross-origin data access | Browser same-origin policy; no cross-origin storage access |

---

## 11. Mobile Runtime Path

### Strategy

The same artifact format (WASM engine, SQLite catalog, JSON config) is used on mobile. The **`IRecoRuntime`** interface defines the contract between the recommendation logic and the platform runtime:

- **Web**: Implemented by the Compute Worker + Service Worker stack described in this document.
- **iOS/Android**: Implemented by a native SDK that uses the platform's WASM runtime (or a compiled-native equivalent) and local SQLite.

### Shared Artifacts

| Artifact | Web Runtime | Native Runtime |
|----------|------------|----------------|
| WASM Engine | Browser WASM runtime in Worker | Platform WASM runtime (e.g., Wasmer, Wasmtime) or AOT-compiled native |
| Catalog (SQLite) | sql.js / wa-sqlite in Worker | Native SQLite |
| Config JSON | Parsed in Worker | Parsed natively |
| Manifest | Fetched by Service Worker | Fetched by native sync manager |

### IRecoRuntime Boundary

The interface abstracts:
- Engine initialization and teardown
- Recommendation query execution
- Catalog synchronization
- Event reporting
- Health status

> Full `IRecoRuntime` interface definition is in the [Technical Specification](TECH_SPEC.md#10-mobile-runtime-interface).

---

## 12. Architecture Decision Records (Summary)

| ADR | Decision | Rationale |
|-----|----------|-----------|
| ADR-001 | WASM over pure JavaScript for inference engine | Predictable performance, language flexibility (Rust), near-native speed for scoring loops, portable to mobile |
| ADR-002 | Dedicated Worker over Service Worker for compute | Service Workers have lifecycle constraints (idle termination); Dedicated Workers are long-lived and controlled by the page |
| ADR-003 | OPFS over IndexedDB for large binaries | OPFS provides file-system-like access with better performance for large reads/writes; SQLite WASM can use OPFS as a VFS backend |
| ADR-004 | Delta patches over full catalog re-downloads | Catalogs change incrementally (price updates, new products); deltas reduce bandwidth by 90%+ for daily updates |
| ADR-005 | `sendBeacon` for event uplink on page unload | `sendBeacon` is fire-and-forget and survives page navigation; `fetch` with `keepalive` is the fallback |
| ADR-006 | Manifest-driven rollout over feature flags service | No additional backend dependency; CDN-served manifest is consistent with the CDN-first philosophy; kill switch is a manifest field |

---

## 13. Appendix

### A. Glossary

See the [PRD Glossary](PRD.md#12-glossary) for shared terms. Additional architecture-specific terms:

| Term | Definition |
|------|------------|
| **Content-addressed URL** | A URL where the path includes the hash of the content, ensuring immutability and cache-friendliness |
| **Degradation ladder** | The ordered sequence of fallback states from full local inference to no recommendations |
| **IRecoRuntime** | The platform-agnostic interface for recommendation runtime operations |
| **Shadow load** | Loading a new engine version alongside the active one for testing before activation |
| **VFS** | Virtual File System — the abstraction SQLite uses to interact with OPFS |

### B. Browser Compatibility Matrix

| Feature | Chrome | Firefox | Safari | Edge |
|---------|--------|---------|--------|------|
| WASM | 57+ | 52+ | 11+ | 16+ |
| Dedicated Workers | 4+ | 3.5+ | 4+ | 12+ |
| Service Workers | 40+ | 44+ | 11.1+ | 17+ |
| OPFS | 86+ | 111+ | 16.4+ | 86+ |
| IndexedDB | 24+ | 16+ | 10+ | 12+ |
| Cache API | 40+ | 39+ | 11.1+ | 16+ |
| `sendBeacon` | 39+ | 31+ | 11.1+ | 14+ |
| WASM Threads | 74+ | 79+ | 16.4+ | 79+ |

**Minimum target**: Chrome 90+, Firefox 100+, Safari 16.4+, Edge 90+

### C. Estimated Artifact Sizes

| Artifact | Size (Gzipped) | Size (Raw) | Update Frequency |
|----------|---------------|------------|-----------------|
| WASM Engine | ~1-2 MB | ~3-5 MB | Weekly-Monthly |
| Catalog Snapshot | ~5-10 MB | ~15-30 MB | Weekly (initial + rebase) |
| Catalog Delta Patch | ~100 KB - 1 MB | ~300 KB - 3 MB | Daily |
| Config | ~1-5 KB | ~3-15 KB | As needed |
| Manifest | ~1-2 KB | ~3-5 KB | On every publish |
