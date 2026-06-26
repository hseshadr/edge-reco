# EdgeReco — Technical Specification

| Field | Value |
|-------|-------|
| **Version** | 1.0 |
| **Status** | Draft |
| **Last Updated** | 2026-02-28 |
| **Companion Docs** | [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) |

---

> **TLDR** — **SDK API**: `init()` detects device capability and boots workers, `getRecommendations()` returns `RecoResponse` with `source: "local" | "backend" | "degraded"`, `reportInteraction()` queues events, `destroy()` tears down. **Hybrid Router**: check kill switch → check device capability → check engine readiness → race local inference against timeout → fall back to backend. **Storage**: OPFS holds SQLite catalog + WASM binary; IndexedDB stores manifest, user state, event queue, sync metadata; Cache API handles HTTP artifacts. **Performance budgets**: cold start < 3s, warm inference p95 < 10ms, WASM < 2MB gzipped, peak memory < 128MB, zero main-thread blocking. **Events**: 13 event types (interactions + system + metrics) batched ≤ 50 events / 64KB, uplinked via `fetch` or `sendBeacon`, deterministic per-device sampling.

## 1. Technical Overview

### Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Inference Engine | Rust → WASM (wasm-pack) | Recommendation scoring and ranking |
| Catalog Storage | SQLite WASM (wa-sqlite / sql.js) | Queryable product catalog on-device |
| File Storage | OPFS (Origin Private File System) | Large binary storage (catalog DB, WASM engine) |
| Structured Storage | IndexedDB | Manifest cache, user state, event queue, sync metadata |
| HTTP Artifact Cache | Cache API | Service Worker-managed artifact caching |
| Event Uplink | `sendBeacon` / `fetch` with `keepalive` | Anonymous interaction event transmission |
| Artifact Distribution | CDN (static files) | Content-addressed immutable artifacts |
| Background Sync | Service Worker | Manifest polling, artifact updates, event flush |
| Compute Isolation | Dedicated Web Worker | Off-main-thread inference execution |

---

## 2. Hybrid Router

The Hybrid Router is a main-thread component that decides whether to route each recommendation request to the local WASM engine or to the backend API.

### Decision Algorithm

```
function route(request: RecoRequest): RecoResponse
    if kill_switch is active:
        return backend_fallback(request)

    if capability_tier is "insufficient":
        emit_event(FALLBACK, reason: "capability_blocked")
        return backend_fallback(request)

    if engine_status is not READY:
        return backend_fallback(request)

    effective_timeout = capability_tier is "medium"
        ? min(request.timeout ?? 200, 500)
        : request.timeout ?? 200

    result = await_with_timeout(
        local_inference(request),
        timeout_ms = effective_timeout
    )

    if result is success:
        return result with source = "local"

    if result is timeout or error:
        log_error(result)
        return backend_fallback(request)
```

### TypeScript API Contract

```typescript
interface RecoRequest {
  /** Placement identifier (e.g., "pdp-similar", "cart-cross-sell") */
  placement: string;
  /** Context item IDs (e.g., current product being viewed) */
  contextItemIds?: string[];
  /** Maximum number of recommendations to return */
  limit?: number;
  /** Local inference timeout in ms (default: 200) */
  timeout?: number;
  /** Opaque metadata forwarded to the engine */
  metadata?: Record<string, string>;
}

interface RecoResponse {
  /** Ordered list of recommended items */
  items: RecoItem[];
  /** Where the recommendation was generated */
  source: "local" | "backend" | "degraded";
  /** Engine version hash (if source is "local") */
  engineVersion: string | null;
  /** Time taken in ms */
  latencyMs: number;
  /** Request trace ID for observability */
  traceId: string;
}

interface RecoItem {
  /** Product identifier */
  itemId: string;
  /** Relevance score (0-1, higher is better) */
  score: number;
  /** Reason code for explainability (e.g., "similar-category", "co-purchase") */
  reason?: string;
}
```

### Timeout & Error Handling

| Scenario | Behavior |
|----------|----------|
| Local inference completes within timeout | Return local result |
| Local inference exceeds timeout | Cancel Worker task, return backend fallback |
| Compute Worker unresponsive (no heartbeat for 5s) | Terminate and restart Worker, return backend fallback |
| Backend fallback also fails | Return degraded result (popular items from cached catalog) |
| Device capability insufficient | Skip WASM artifact download and Compute Worker creation, route all to backend | Re-detect on next session or SDK update |
| All paths fail | Return empty `RecoResponse` with `source: "degraded"` and `items: []` |

---

## 3. Service Worker

### Registration Lifecycle

```
1. SDK.init() called on main thread
2. navigator.serviceWorker.register("/edgereco-sw.js")
3. On "install":
   - Pre-cache critical assets (SW script itself)
   - Skip waiting (activate immediately)
4. On "activate":
   - Claim all clients
   - Start manifest poll loop
5. On "fetch" (scoped to /edgereco/* paths):
   - Serve artifacts from Cache API if available
   - Otherwise, fetch from CDN and cache
6. On "message" from main thread:
   - Handle flush/sync commands
```

### Manifest Management

The Service Worker polls the manifest on a fixed interval (default: 60 seconds).

```
function manifest_poll_loop():
    while true:
        sleep(POLL_INTERVAL)
        new_manifest = fetch("/edgereco/manifest.json")

        if fetch fails:
            continue with cached manifest

        if new_manifest.version == cached_manifest.version:
            continue

        diff = compare(cached_manifest, new_manifest)

        if diff.engine_changed:
            download_and_cache(new_manifest.engine)
            notify_compute_worker("new_engine", new_manifest.engine)

        if diff.catalog_changed:
            if delta_available(cached_manifest.catalog, new_manifest.catalog):
                download_and_apply_delta(delta_url)
            else:
                download_full_catalog(new_manifest.catalog)

        if diff.config_changed:
            download_and_cache(new_manifest.config)
            notify_compute_worker("new_config", new_manifest.config)

        save_manifest(new_manifest)
```

### Artifact Caching Strategy

| Action | Implementation |
|--------|---------------|
| Store artifact | `caches.open("edgereco-v1").put(url, response)` |
| Retrieve artifact | `caches.match(request)` with fallback to network |
| Validate integrity | Compare SHA256 of response body against hash in URL path |
| Evict old artifacts | On successful engine/catalog activation, delete Cache API entries for previous versions |

### Background Sync Orchestration

The Service Worker coordinates two background sync tasks:

1. **Artifact Sync** — Manifest polling and artifact download (described above).
2. **Event Flush** — Periodic uplink of queued interaction events from IndexedDB.

Both tasks run on the poll interval. Event flush also triggers on `beforeunload` via `sendBeacon`.

### Main Thread Communication

```typescript
// Main thread → Service Worker
navigator.serviceWorker.controller.postMessage({
  type: "FLUSH_EVENTS" | "FORCE_SYNC" | "GET_STATUS",
  payload?: any
});

// Service Worker → Main thread (via MessageChannel or BroadcastChannel)
client.postMessage({
  type: "MANIFEST_UPDATED" | "ARTIFACT_READY" | "SYNC_STATUS",
  payload: { ... }
});
```

---

## 4. Compute Worker

### Lifecycle

```
1. Main thread creates: new Worker("/edgereco-compute.js")
2. Worker initializes:
   a. Load WASM engine binary from OPFS
   b. Instantiate WASM module, call reco_init()
   c. Open SQLite database from OPFS (catalog.db)
   d. Load user_state from IndexedDB
   e. Post "READY" status to main thread
3. Worker enters message loop:
   - Process incoming RecoQuery commands
   - Handle engine hot-swap commands
   - Respond with RecoResult or error
4. On termination:
   - Flush any pending state to IndexedDB
```

### WASM Engine Integration

The WASM engine exposes the following functions via its exported interface:

```rust
// Rust source → compiled to WASM

/// Initialize the engine with model weights and config.
/// Returns 0 on success, error code on failure.
#[wasm_bindgen]
pub fn reco_init(model_bytes: &[u8], config_json: &str) -> i32;

/// Execute a recommendation query.
/// Input: JSON-serialized query context.
/// Output: JSON-serialized ranked results.
#[wasm_bindgen]
pub fn reco_query(context_json: &str) -> String;

/// Apply a delta patch to the engine's internal state (if applicable).
/// Returns 0 on success, error code on failure.
#[wasm_bindgen]
pub fn reco_apply_patch(patch_bytes: &[u8]) -> i32;

/// Update engine configuration without reloading weights.
/// Returns 0 on success, error code on failure.
#[wasm_bindgen]
pub fn reco_apply_config(config_json: &str) -> i32;

/// Run a smoke test query and return validation result.
/// Returns JSON: { "pass": bool, "details": string }
#[wasm_bindgen]
pub fn reco_smoke_test() -> String;
```

### SQLite Integration

The Compute Worker hosts a SQLite WASM instance with OPFS as the VFS backend:

- **Database file**: `OPFS:/edgereco/catalog.db`
- **Access mode**: Read-only (writes only happen during delta-sync, coordinated by Service Worker)
- **Query pattern**: The WASM engine calls into SQLite via the Worker's JS glue to fetch item features for scoring.

### postMessage Protocol

```typescript
// Main thread → Compute Worker
type WorkerCommand =
  | { id: string; type: "RECO_QUERY"; payload: RecoQueryPayload }
  | { id: string; type: "LOAD_ENGINE"; payload: { path: string } }
  | { id: string; type: "APPLY_CONFIG"; payload: { configJson: string } }
  | { id: string; type: "SMOKE_TEST" }
  | { id: string; type: "GET_STATUS" }
  | { id: string; type: "SHUTDOWN" };

interface RecoQueryPayload {
  placement: string;
  contextItemIds: string[];
  limit: number;
  userState: UserLocalState;
  metadata?: Record<string, string>;
}

// Compute Worker → Main thread
type WorkerResponse =
  | { id: string; type: "RECO_RESULT"; payload: RecoResultPayload }
  | { id: string; type: "ENGINE_LOADED"; payload: { version: string } }
  | { id: string; type: "CONFIG_APPLIED" }
  | { id: string; type: "SMOKE_RESULT"; payload: { pass: boolean; details: string } }
  | { id: string; type: "STATUS"; payload: EngineStatus }
  | { id: string; type: "ERROR"; payload: { code: string; message: string } }
  | { id: string; type: "READY" };

interface RecoResultPayload {
  items: Array<{ itemId: string; score: number; reason?: string }>;
  /** Engine version hash — always present since results only come from the engine */
  engineVersion: string;
  inferenceTimeMs: number;
}

interface EngineStatus {
  state: "INITIALIZING" | "READY" | "ERROR" | "SWAPPING" | "CAPABILITY_BLOCKED";
  engineVersion: string | null;
  catalogVersion: string | null;
  memoryUsageMb: number;
  uptime: number;
}
```

### Concurrency Model

- The Compute Worker processes one `RECO_QUERY` at a time (single-threaded WASM execution).
- Incoming queries while one is in-flight are queued in the Worker's message buffer.
- The main-thread Hybrid Router enforces timeouts; it does not wait for queued queries.
- Engine hot-swap (`LOAD_ENGINE`) blocks query processing — queries received during swap are held until the new engine is ready or the swap fails.

---

## 5. Storage Layer

### OPFS Layout

```
/edgereco/
├── catalog.db          # SQLite database (current catalog)
├── catalog.db.bak      # Previous catalog version (rollback)
├── engine.wasm         # Current WASM engine binary
└── engine.wasm.prev    # Previous engine binary (rollback)
```

### IndexedDB Schema

**Database name**: `edgereco`

#### Object Store: `manifest`

```typescript
// Key: "current"
interface ManifestRecord {
  version: string;
  engineHash: string;
  engineUrl: string;
  catalogHash: string;
  catalogUrl: string;
  configHash: string;
  configUrl: string;
  deltaChain: Array<{
    fromHash: string;
    toHash: string;
    url: string;
    sizeBytes: number;
  }>;
  canary: {
    enabled: boolean;
    percentage: number;
    engineHash?: string;
    engineUrl?: string;
  };
  killSwitch: boolean;
  minClientVersion: string;
  fetchedAt: number; // Unix timestamp ms
}
```

#### Object Store: `user_state`

```typescript
// Key: "local"
interface UserLocalState {
  anonymousId: string;
  /** Circular buffer of recent interactions, newest first */
  recentInteractions: Array<{
    itemId: string;
    action: "view" | "click" | "add_to_cart" | "purchase";
    timestamp: number;
  }>;
  /** Category affinity scores, decayed over time */
  categoryAffinities: Record<string, number>;
  /** Session-level context */
  session: {
    startedAt: number;
    pageViews: number;
    referralSource?: string;
  };
  updatedAt: number;
}
```

#### Object Store: `event_queue`

```typescript
// Key: auto-increment
interface EventQueueEntry {
  id?: number; // Auto-generated
  event: EdgeEvent;
  queuedAt: number;
  retryCount: number;
}
```

#### Object Store: `sync_metadata`

```typescript
// Key: "catalog" | "engine" | "config"
interface SyncMetadataRecord {
  artifactType: "catalog" | "engine" | "config";
  currentHash: string;
  lastSyncAt: number;
  lastSyncResult: "success" | "error";
  lastError?: string;
  syncCount: number;
}
```

#### Object Store: `preferences`

```typescript
// Key: "user_prefs"
interface UserPreferences {
  consentGranted: boolean;
  eventSamplingOverride?: number; // 0-1, overrides server sampling rate
  debugMode: boolean;
}
```

### UserLocalState Interface

The `UserLocalState` is the bridge between stored interaction history and the WASM engine's scoring function. It is:

- **Written** by the SDK API layer when `reportInteraction()` is called.
- **Read** by the Compute Worker before each `RECO_QUERY`.
- **Bounded**: `recentInteractions` is a circular buffer (default max: 200 entries). `categoryAffinities` are time-decayed (halving every 7 days).

### Quota Management

| Strategy | Detail |
|----------|--------|
| Monitor usage | Periodically check `navigator.storage.estimate()` |
| Warn threshold | Report observability event when usage > 40MB |
| Eviction priority | 1. Old delta patches, 2. Previous engine backup, 3. Catalog backup |
| Graceful degradation | If quota critically low, skip catalog sync, keep current cached data |
| Hard limit response | If storage writes fail, switch to backend-only mode, report error |

---

## 6. Artifact Formats

### Catalog Snapshot (SQLite)

The catalog is a read-only SQLite database with the following schema:

```sql
PRAGMA user_version = 1;

CREATE TABLE products (
    item_id     TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    category_id TEXT NOT NULL,
    price       REAL NOT NULL,
    image_url   TEXT,
    -- Feature vector for scoring (packed little-endian float32 array, raw binary)
    features    BLOB NOT NULL,
    -- Popularity score (pre-computed, 0-1)
    popularity  REAL NOT NULL DEFAULT 0,
    -- Availability flag
    in_stock    INTEGER NOT NULL DEFAULT 1,
    updated_at  INTEGER NOT NULL
);

CREATE TABLE categories (
    category_id   TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    parent_id     TEXT,
    -- Category-level feature vector
    features      BLOB,
    product_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_products_popularity ON products(popularity DESC);
CREATE INDEX idx_products_in_stock ON products(in_stock) WHERE in_stock = 1;
```

#### Pluggability & Dataset Agnosticism

The catalog schema is **dataset-agnostic** — any product set conforming to the `products` and `categories` tables works. The `features` BLOB column accepts embedding vectors of **any dimensionality**; the engine reads the expected dimension from the config JSON (`engine_config`), not from the schema.

EdgeReco is not tightly coupled to any specific code or data. The platform's stable contracts — the client SDK API (`RecoRequest`/`RecoResponse`), the backend REST API (`POST /v1/recommendations`), the storage schema, and the WASM engine ABI (`reco_query`) — are all generic. Integrators swap in their own product catalog, embedding model, scoring engine, and training pipeline without modifying platform code. Deploying a new algorithm or dataset is a CDN artifact publish, not a code change.

#### Prototype Reference Dataset

The personalization prototype uses the following dataset as a concrete example:

| Field | Value |
|-------|-------|
| **Dataset** | Amazon Reviews 2023 — All Beauty |
| **Source** | [`McAuley-Lab/Amazon-Reviews-2023`](https://huggingface.co/datasets/McAuley-Lab/Amazon-Reviews-2023) (HuggingFace, `raw_meta_All_Beauty` subset) |
| **Fallback source** | [`milistu/AMAZON-Products-2023`](https://huggingface.co/datasets/milistu/AMAZON-Products-2023) |
| **Approximate size** | ~117K products |
| **Local cache path** | `backend/demo-service/data/amazon_products.parquet` |
| **Embedding model** | `all-MiniLM-L6-v2` (SentenceTransformers), 384-dimensional vectors |

**Field mapping to catalog schema:**

| Parquet field | Catalog column | Notes |
|--------------|----------------|-------|
| `item_id` | `products.item_id` | ASIN identifier |
| `title` | `products.title` | Product title |
| `description` | — | Concatenated into embedding input |
| `category` | `categories.name` | Leaf category |
| `main_category` | `categories.parent_id` | Top-level category |
| `image_url` | `products.image_url` | First image URL |
| *(computed)* | `products.features` | 384-dim float32 BLOB from `all-MiniLM-L6-v2` over `title + description` |

### Delta Patch Binary Format

Delta patches update an existing catalog from one version to the next.

```
Offset  Size     Field
─────────────────────────────────
0       4        Magic bytes: 0x45 0x52 0x44 0x50 ("ERDP" — EdgeReco Delta Patch)
4       1        Format version (uint8, currently 1)
5       32       Base catalog SHA256 hash (the version this patch applies to)
37      32       Target catalog SHA256 hash (the version after applying this patch)
69      4        Payload length in bytes (uint32, big-endian)
73      N        Payload: sequence of SQL statements (gzip-compressed UTF-8)
                 Each statement terminated by ";\n"
                 Supported: INSERT, UPDATE, DELETE on products/categories tables
```

**Application process**:
1. Verify base hash matches current catalog hash.
2. Decompress payload.
3. Execute SQL statements within a transaction.
4. Verify resulting database hash matches target hash.
5. On mismatch: rollback transaction, report error, schedule full snapshot download.

### WASM Binary Naming

```
/edgereco/engines/{sha256_hex}.wasm
```

- The SHA256 is computed over the raw (uncompressed) `.wasm` binary.
- CDN serves with `Content-Encoding: gzip` (or Brotli) transparently.

### Config Patch JSON Structure

```json
{
  "schema_version": 1,
  "engine_config": {
    "feature_dimensions": 384,
    "num_candidates": 100,
    "num_results": 20,
    "diversity_factor": 0.3,
    "popularity_weight": 0.2,
    "personalization_weight": 0.5,
    "recency_weight": 0.3
  },
  "placement_overrides": {
    "pdp-similar": {
      "num_results": 10,
      "diversity_factor": 0.1
    },
    "cart-cross-sell": {
      "num_results": 5,
      "diversity_factor": 0.5
    }
  },
  "feature_flags": {
    "enable_category_boost": true,
    "enable_price_sensitivity": false
  }
}
```

Config updates are **additive-only** within a major version — new fields may be added, existing fields retain their meaning. A `schema_version` bump indicates a breaking change requiring a matching engine version.

> **Note**: `feature_dimensions` is dataset-dependent; the prototype value of `384` matches the `all-MiniLM-L6-v2` embedding model. Integrators set this to match their chosen embedding dimensionality.

---

## 7. Manifest Design

### Manifest Structure

The manifest follows the `ManifestRecord` TypeScript interface defined in [Section 5 — Storage Layer](#5-storage-layer). The manifest JSON uses `snake_case` keys matching the CDN representation; the `ManifestRecord` interface uses `camelCase` as consumed by the SDK. Required top-level fields: `schema_version`, `version`, `engine`, `catalog`, `config`, `kill_switch`.

### Example Manifest

```json
{
  "schema_version": 1,
  "version": "2026-02-28T12:00:00Z",
  "engine": {
    "hash": "a1b2c3d4e5f6...",
    "url": "https://cdn.example.com/edgereco/engines/a1b2c3d4e5f6.wasm",
    "semver": "1.3.0",
    "min_config_schema": 1
  },
  "catalog": {
    "hash": "f6e5d4c3b2a1...",
    "url": "https://cdn.example.com/edgereco/catalogs/f6e5d4c3b2a1.db",
    "delta_chain": [
      {
        "from_hash": "0a1b2c3d4e5f...",
        "to_hash": "f6e5d4c3b2a1...",
        "url": "https://cdn.example.com/edgereco/deltas/abc123.delta",
        "size_bytes": 524288
      }
    ]
  },
  "config": {
    "hash": "1a2b3c4d5e6f...",
    "url": "https://cdn.example.com/edgereco/configs/1a2b3c4d5e6f.json"
  },
  "canary": {
    "enabled": true,
    "percentage": 5,
    "engine": {
      "hash": "b2c3d4e5f6a1...",
      "url": "https://cdn.example.com/edgereco/engines/b2c3d4e5f6a1.wasm",
      "semver": "1.4.0-rc1"
    }
  },
  "kill_switch": false,
  "min_client_version": "0.1.0",
  "event_sampling": {
    "interaction_rate": 0.1,
    "metric_rate": 0.01,
    "error_rate": 1.0
  }
}
```

### Variation / Canary Mechanics

1. Client computes: `bucket = hash(anonymousId + manifestVersion) % 100`
2. If `bucket < canary.percentage` → use `canary.engine`
3. Otherwise → use main `engine`
4. Bucketing is deterministic per user per manifest version — no flickering between versions.

### Manifest Lifecycle

![Manifest Lifecycle](diagrams/manifest-lifecycle.svg)

---

## 8. Event Schema & Uplink Pipeline

### Event Types

```typescript
enum EventType {
  // Interaction events
  IMPRESSION = "impression",
  CLICK = "click",
  ADD_TO_CART = "add_to_cart",
  PURCHASE = "purchase",
  DISMISS = "dismiss",

  // System events
  CAPABILITY_DETECTED = "capability_detected",
  ENGINE_LOADED = "engine_loaded",
  ENGINE_SWAP = "engine_swap",
  SMOKE_TEST = "smoke_test",
  FALLBACK = "fallback",
  ERROR = "error",

  // Metric events
  LATENCY = "latency",
  STORAGE_USAGE = "storage_usage"
}
```

### EdgeEvent Envelope

```typescript
interface EdgeEvent {
  /** Event type */
  type: EventType;
  /** Unix timestamp in milliseconds */
  timestamp: number;
  /** Anonymous device ID */
  deviceId: string;
  /** SDK version */
  sdkVersion: string;
  /** Active engine version hash (null if backend fallback) */
  engineVersion: string | null;
  /** Placement context (null for system events) */
  placement: string | null;
  /** Event-specific payload */
  data: Record<string, unknown>;
}
```

### Event Data Schemas

Each event type requires specific fields in the `data` payload:

| Event Type | Required `data` Fields |
|-----------|----------------------|
| `impression` | `itemIds: string[]`, `position?: number` |
| `click` | `itemId: string`, `position: number` |
| `add_to_cart` | `itemId: string`, `quantity?: number` |
| `purchase` | `itemIds: string[]`, `totalValue?: number` |
| `dismiss` | `itemId: string` |
| `capability_detected` | `tier: string`, `cores: number`, `memoryGb: number`, `benchmarkMs: number` |
| `engine_loaded` | `version: string`, `loadTimeMs: number` |
| `engine_swap` | `fromVersion: string`, `toVersion: string`, `result: string` |
| `smoke_test` | `version: string`, `pass: boolean`, `details: string` |
| `fallback` | `reason: string` |
| `error` | `code: string`, `message: string`, `component: string` |
| `latency` | `source: string`, `durationMs: number`, `placement: string` |
| `storage_usage` | `totalBytes: number`, `opfsBytes: number`, `idbBytes: number` |

### EventBatch Format

```typescript
interface EventBatch {
  /** Batch ID (UUID) */
  batchId: string;
  /** Number of events in batch */
  count: number;
  /** Events */
  events: EdgeEvent[];
  /** Client timestamp when batch was assembled */
  assembledAt: number;
}
```

Serialized as JSON. Maximum batch size: 50 events or 64KB, whichever is reached first.

### Uplink Protocol

| Method | Endpoint | Content-Type | Auth |
|--------|----------|-------------|------|
| POST | `/v1/edgereco/events` | `application/json` | Origin-based (same-site cookie or API key header) |

**Primary path**: `fetch()` with `keepalive: true` during normal operation.

**Page unload path**: `navigator.sendBeacon(url, blob)` on `visibilitychange` (hidden) or `pagehide`.

**Response**: `202 Accepted` on success. No response body expected. Client does not retry on 4xx (malformed). Client retries on 5xx with exponential backoff (max 3 retries).

### Local Queue Management

- Events are written to the `event_queue` IDB store immediately when `reportInteraction()` is called.
- The Service Worker flushes the queue on a periodic interval (default: 30 seconds).
- On successful uplink, flushed events are deleted from the queue.
- On failure, events remain in the queue with `retryCount` incremented.
- Events with `retryCount > 3` are dropped silently.
- Queue is bounded: if > 1000 events are pending, oldest events are dropped.

### Sampling Configuration

Sampling rates are defined in the manifest's `event_sampling` field:

| Event Category | Rate Field | Default | Description |
|---------------|------------|---------|-------------|
| Interactions | `interaction_rate` | 0.1 (10%) | impression, click, add_to_cart, purchase, dismiss |
| Metrics | `metric_rate` | 0.01 (1%) | latency, storage_usage |
| Errors/System | `error_rate` | 1.0 (100%) | error, fallback, engine_swap, smoke_test, engine_loaded |

Sampling decision: `hash(deviceId + eventType + hourBucket) % 1000 < rate * 1000`. This ensures consistent sampling per device per event type per hour.

---

## 9. API Contracts

> **Serialization convention**: The TypeScript SDK uses `camelCase` property names (e.g., `contextItemIds`, `engineVersion`). The backend REST API uses `snake_case` (e.g., `context_item_ids`, `engine_version`). The SDK handles conversion transparently — callers always use camelCase.

### Client-Facing SDK API

```typescript
class EdgeReco {
  /**
   * Initialize the EdgeReco SDK.
   * Registers Service Worker, starts manifest sync, boots Compute Worker.
   * Resolves when the system is ready (or falls back to backend mode).
   */
  static async init(config: InitConfig): Promise<EdgeReco>;

  /**
   * Get personalized recommendations.
   * Transparently routes to local engine or backend fallback.
   */
  async getRecommendations(request: RecoRequest): Promise<RecoResponse>;

  /**
   * Report a user interaction for personalization and analytics.
   * Non-blocking — events are queued and flushed asynchronously.
   */
  reportInteraction(event: InteractionEvent): void;

  /**
   * Tear down the SDK: stop workers, flush events, optionally wipe storage.
   * @param wipeStorage If true, delete all local data (OPFS, IDB, Cache API).
   */
  async destroy(wipeStorage?: boolean): Promise<void>;

  /**
   * Get current health status of the edge recommendation system.
   */
  async getHealthStatus(): Promise<HealthStatus>;
}

interface InitConfig {
  /** Base URL for CDN artifacts (default: "/edgereco") */
  cdnBase?: string;
  /** Backend fallback API URL */
  backendUrl: string;
  /** Manifest poll interval in ms (default: 60000) */
  pollInterval?: number;
  /** Enable debug logging (default: false) */
  debug?: boolean;
  /** Consent for event uplink (default: false) */
  consentGranted?: boolean;
  /** Override capability detection. "local" forces local, "backend" forces backend-only. */
  capabilityOverride?: "local" | "backend";
  /** Custom thresholds for capability detection (merged with defaults). */
  capabilityThresholds?: Partial<CapabilityThresholds>;
}

interface CapabilityThresholds {
  /** Minimum CPU cores (default: 2) */
  minCores: number;
  /** Minimum device memory in GB, Chromium only (default: 1) */
  minMemoryGb: number;
  /** Benchmark ceiling in ms — above this = "insufficient" (default: 150) */
  benchmarkCeilingMs: number;
  /** Benchmark floor in ms — below this = "high" (default: 50) */
  benchmarkFloorMs: number;
}

interface InteractionEvent {
  type: "impression" | "click" | "add_to_cart" | "purchase" | "dismiss";
  itemId: string;
  placement: string;
  metadata?: Record<string, string>;
}

interface HealthStatus {
  /** Overall system state */
  state: "healthy" | "degraded" | "backend_only" | "offline";
  /** Active engine version (null if backend mode) */
  engineVersion: string | null;
  /** Catalog version hash */
  catalogVersion: string | null;
  /** Seconds since last successful manifest sync */
  lastSyncAge: number;
  /** Approximate storage usage in bytes */
  storageUsageBytes: number;
  /** Number of pending events in queue */
  pendingEvents: number;
}
```

### Backend Fallback API

**Endpoint**: `POST {backendUrl}/v1/recommendations`

**Request**:
```json
{
  "placement": "pdp-similar",
  "context_item_ids": ["PROD-123"],
  "limit": 20,
  "device_id": "anon-uuid",
  "metadata": {}
}
```

**Response** (`200 OK`):
```json
{
  "items": [
    { "item_id": "PROD-456", "score": 0.95, "reason": "similar-category" },
    { "item_id": "PROD-789", "score": 0.87, "reason": "co-purchase" }
  ],
  "engine_version": "server-v2.1.0",
  "trace_id": "abc-123-def"
}
```

### Inventory Validation API

**Endpoint**: `GET {backendUrl}/v1/inventory/validate`

**Query params**: `item_ids=PROD-123,PROD-456` (comma-separated, max 100)

**Response** (`200 OK`):
```json
{
  "items": {
    "PROD-123": { "in_stock": true, "price": 29.99 },
    "PROD-456": { "in_stock": false, "price": null }
  }
}
```

This optional API allows the client to validate that locally-recommended items are still in stock and at the expected price before rendering.

---

## 10. Mobile Runtime Interface

### IRecoRuntime Interface

```typescript
/**
 * Platform-agnostic interface for the recommendation runtime.
 * Implemented by the web Compute Worker stack and by native mobile SDKs.
 */
interface IRecoRuntime {
  /** Initialize the runtime with configuration. */
  init(config: RuntimeConfig): Promise<void>;

  /** Execute a recommendation query. */
  query(request: RecoRequest): Promise<RecoResponse>;

  /** Report an interaction event. */
  reportEvent(event: InteractionEvent): void;

  /** Trigger a sync check for new artifacts. */
  sync(): Promise<SyncResult>;

  /** Get current runtime health and status. */
  getStatus(): Promise<RuntimeStatus>;

  /** Destroy the runtime and release resources. */
  destroy(wipeStorage?: boolean): Promise<void>;
}

interface RuntimeConfig {
  cdnBase: string;
  backendUrl: string;
  pollInterval: number;
  storagePath?: string; // Native only: filesystem path for artifacts
}

interface SyncResult {
  engineUpdated: boolean;
  catalogUpdated: boolean;
  configUpdated: boolean;
  errors: string[];
}

interface RuntimeStatus {
  state: "initializing" | "ready" | "error" | "offline";
  engineVersion: string | null;
  catalogVersion: string | null;
  storageUsageBytes: number;
}
```

### Web Implementation Notes

On web, `IRecoRuntime` is implemented by the orchestration of:
- Compute Worker (query execution via postMessage)
- Service Worker (artifact sync)
- IndexedDB + OPFS (storage)
- SDK API layer (public surface)

The SDK API layer (`EdgeReco` class) is the web-specific wrapper around `IRecoRuntime`.

### Native Implementation Notes

On iOS/Android, `IRecoRuntime` is implemented by:
- A native WASM runtime (Wasmer/Wasmtime) or AOT-compiled native code for the engine.
- Native SQLite for catalog access.
- Platform file system for artifact storage.
- Platform HTTP client for CDN fetches and event uplink.
- Background task scheduler for periodic sync (replacing Service Worker).

### Platform Capability Matrix

| Capability | Web | iOS | Android |
|-----------|-----|-----|---------|
| WASM Engine | Browser WASM | Wasmer / AOT | Wasmer / AOT |
| Catalog (SQLite) | wa-sqlite (OPFS VFS) | Native SQLite | Native SQLite |
| Artifact Storage | OPFS + Cache API | App sandbox filesystem | App sandbox filesystem |
| Background Sync | Service Worker | BGTaskScheduler | WorkManager |
| Event Uplink | sendBeacon / fetch | URLSession | OkHttp |
| Offline Support | Cache API + OPFS | Filesystem cache | Filesystem cache |

---

## 11. Versioning & Compatibility

### Manifest Schema Versioning

- The `schema_version` field in the manifest is an integer.
- Clients that encounter an unknown `schema_version` must fall back to backend mode and report an error (SDK update required).
- Schema versions are backwards-compatible within the same major version (new fields only).

### Engine Semantic Versioning

- Engines follow semver: `MAJOR.MINOR.PATCH`.
- **MAJOR**: Breaking changes to query input/output format.
- **MINOR**: New features, backwards-compatible.
- **PATCH**: Bug fixes, performance improvements.
- The manifest's `engine.min_config_schema` field ensures engine-config compatibility.

### Catalog Schema Versioning

- The catalog SQLite schema is versioned via a `PRAGMA user_version` value.
- Delta patches are only valid between catalogs of the same schema version.
- A schema version change requires a full catalog snapshot download.

### Config Additive-Only Policy

Within a `schema_version`:
- New fields may be added to config JSON.
- Existing fields must not change meaning.
- Engines must tolerate unknown fields (forward-compatible).
- A `schema_version` bump is required for breaking config changes and must be paired with a new engine version.

---

## 12. Performance Budgets

| Metric | Budget | Measurement Method |
|--------|--------|--------------------|
| Cold start (first recommendation) | < 3 seconds | `performance.mark` from `init()` to first `getRecommendations()` result |
| Warm start (cached state → ready) | < 50ms | `performance.mark` from `init()` to `READY` Worker message |
| Local inference latency (p95) | < 10ms | `performance.mark` around `reco_query()` call |
| WASM engine binary (gzipped) | < 2 MB | Build output size |
| Catalog snapshot (gzipped) | < 10 MB | Compressed file size |
| Peak memory usage (WASM + SQLite) | < 128 MB | `performance.measureUserAgentSpecificMemory()` or Worker `EngineStatus.memoryUsageMb` |
| Total storage footprint | < 50 MB | `navigator.storage.estimate()` |
| Event uplink payload per batch | < 64 KB | Serialized JSON size |
| Capability detection | < 51ms | Tier 1+2 sync (<1ms) + Tier 3 async (10-50ms, only if borderline) |
| Main thread blocking | < 1ms per SDK call | No synchronous WASM calls on main thread (all via Worker postMessage) |

---

## 13. Testing Strategy

### Unit Testing (Rust + wasm-pack)

- Engine logic tested in native Rust with `cargo test`.
- WASM-specific behavior tested with `wasm-pack test --headless --chrome`.
- Coverage target: core scoring and ranking logic at ≥ 90%.

### Integration Testing (Playwright)

- End-to-end tests running in real browsers via Playwright.
- Scenarios: cold start, warm start, engine hot-swap, fallback, offline.
- Validate that `RecoResponse` contains valid items with correct `source` field.
- Test Service Worker registration, manifest fetch, artifact caching.

### Smoke Test Harness

- Embedded in the WASM engine (`reco_smoke_test()`).
- Run automatically after every engine hot-swap.
- Validates:
  - Output is valid JSON.
  - Result contains ≥ 1 item.
  - All item IDs exist in the catalog.
  - Inference time < 100ms.

### Performance Testing

- Lighthouse custom audits for:
  - Cold start timing.
  - WASM binary size impact on load.
  - Main thread blocking duration.
- Continuous performance budgets enforced in CI.

---

## 14. Appendix

### A. Glossary

See the [PRD Glossary](PRD.md#12-glossary) and [Architecture Glossary](ARCHITECTURE.md#a-glossary) for shared and architecture-specific terms. Additional spec-level terms:

| Term | Definition |
|------|------------|
| **AOT** | Ahead-of-Time compilation — compiling WASM to native code before execution (used on mobile) |
| **postMessage** | The browser API for sending messages between threads (main ↔ Worker) |
| **wa-sqlite** | A SQLite distribution compiled to WASM, suitable for browser use with OPFS VFS |
| **wasm-bindgen** | Rust toolchain for generating JS/WASM interop bindings |
| **wasm-pack** | Build tool for compiling Rust to WASM with npm-compatible packaging |

### B. Content-Addressed URL Algorithm

```
function content_addressed_url(base: string, type: string, binary: Uint8Array): string
    hash = sha256(binary).hex()
    extension = type_to_extension(type)  // "wasm", "db", "delta", "json"
    return `${base}/edgereco/${type}s/${hash}.${extension}`
```

All artifact URLs follow this pattern. The hash is computed over the raw (uncompressed) artifact bytes.

### C. Browser Compatibility & API Fallbacks

**Minimum target**: Chrome 90+, Firefox 100+, Safari 16.4+, Edge 90+

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

**API Fallbacks**:

| API | Polyfill / Fallback |
|-----|-------------------|
| OPFS | Fall back to IndexedDB for large binary storage (with performance degradation) |
| `sendBeacon` | Fall back to `fetch` with `keepalive: true` |
| `navigator.storage.estimate()` | Gracefully degrade quota monitoring if unavailable |
| `performance.measureUserAgentSpecificMemory()` | Skip memory reporting on unsupported browsers |
| Service Worker `periodicSync` | Use `setInterval` within the SW's active lifetime + rely on page-triggered sync |
