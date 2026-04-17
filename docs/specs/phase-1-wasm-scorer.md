# Phase 1 — WASM Scorer Drop-In

| Field | Value |
|-------|-------|
| **Phase** | 1 |
| **Type** | Design spec |
| **Status** | Approved |
| **Authored** | 2026-04-17 |
| **Companion Plan** | [`plans/phase-1-wasm-scorer.md`](../plans/phase-1-wasm-scorer.md) |
| **Depends on** | Phase 0 (merged to main) |

---

## 1. Context

Phase 0 proved the edge-reranking loop with a pure-TypeScript scoring function. Phase 1 replaces that scorer with a Rust → WASM implementation behind the same interface, proving that on-device WASM inference works before investing in the Compute Worker, Service Worker, or CDN delivery infrastructure.

The JS reranker remains as a fallback — the SDK auto-detects WASM availability at init time and selects the best scorer transparently. Zero changes to the SDK public API, the demo app, or the Python API.

## 2. Goals

1. A Rust crate (`crates/engine`) that implements the exact Phase 0 scoring formula, compiled to WASM via `wasm-pack`.
2. An SDK scorer strategy that loads the WASM module at init and falls back to JS silently.
3. A cross-validation test suite proving JS and WASM scorers produce identical output for a shared fixture set.
4. **90% code coverage** across both Rust (via `cargo-tarpaulin` or `llvm-cov`) and TypeScript (via vitest coverage).
5. All existing tests continue to pass unchanged.

## 3. Non-goals

- Compute Worker / main-thread isolation (Phase 4)
- CDN delivery of WASM binary (Phase 2)
- Hot-swap / engine versioning (Phase 2+)
- `reco_init` with model bytes, `reco_apply_config`, `reco_apply_patch` (north star)
- Performance benchmarking beyond basic sanity (Phase 4)

## 4. Architecture

### New files

```
crates/engine/
  Cargo.toml                    # wasm-bindgen, serde, serde_json
  src/
    lib.rs                      # #[wasm_bindgen] rerank export
    scoring.rs                  # pure scoring logic (same formula as JS)
    types.rs                    # serde types: CatalogItem, ProfileSnapshot, RankedItem, etc.
  tests/
    scoring_fixtures.rs         # deterministic fixture tests

packages/engine/
  package.json                  # @edgereco/engine, points to wasm-pack pkg/
  src/
    index.ts                    # async init + typed rerank wrapper
  tsconfig.json
```

### Modified files

```
packages/sdk/
  src/lib/reranker.ts           # refactored: Scorer interface, jsScorer extracted
  src/lib/wasm-loader.ts        # NEW: async WASM loading with error handling
  src/lib/reranker.test.ts      # existing tests unchanged, new cross-validation tests added
  src/lib/wasm-loader.test.ts   # NEW: WASM loading tests (mock + real)
  src/index.ts                  # init() gains WASM loading step
  src/index.test.ts             # existing tests pass, new WASM-enabled tests added

Root:
  biome.json                    # ignore crates/
  .gitignore                    # add target/, crates/engine/pkg/
  package.json                  # add build:wasm script
  pnpm-workspace.yaml           # add packages/engine
```

### Data flow

```
sdk.init()
  └─ try: import("@edgereco/engine") → await init() → WasmScorer
  └─ catch: → JsScorer (existing, unchanged)

sdk.getCandidates()
  └─ fetch candidates from API
  └─ scorer.rerank(candidates, profile) → RankedResponse
       ├─ WasmScorer: JSON.stringify → wasm.rerank() → JSON.parse
       └─ JsScorer: direct function call (Phase 0 code)
```

## 5. Scorer interface

```ts
export interface Scorer {
  rerank(candidates: readonly CatalogItem[], profile: ProfileSnapshot): RankedResponse;
}
```

Both `jsScorer` and `wasmScorer` implement this interface. The SDK holds a reference to whichever was loaded at init time. The interface is synchronous because the WASM call itself is synchronous (only loading is async).

## 6. Rust scoring formula

Identical to `packages/sdk/src/lib/reranker.ts`:

```
score(item, profile) =
    0.50 * item.popularity_score
  + 0.25 * category_match(item, profile)
  + 0.15 * tag_match(item, profile)
  + 0.10 * item.freshness_score
  - repetition_penalty(item, profile)

category_match = profile.category_affinity[item.category] ?? 0
tag_match      = mean(profile.tag_affinity[tag] ?? 0 for tag in item.tags)  [0 if no tags]
repetition_penalty = 0.30 if item.id ∈ profile.recently_viewed else 0.0
```

Weights are constants in a `ScoringWeights` struct, matching `SCORING_WEIGHTS` in the TS codebase:
```rust
pub const WEIGHTS: ScoringWeights = ScoringWeights {
    popularity: 0.5,
    category: 0.25,
    tag: 0.15,
    freshness: 0.1,
    repetition_penalty: 0.3,
};
```

## 7. WASM-bindgen export

```rust
#[wasm_bindgen]
pub fn rerank(candidates_json: &str, profile_json: &str) -> String {
    let candidates: Vec<CatalogItem> = serde_json::from_str(candidates_json).unwrap_or_default();
    let profile: Profile = serde_json::from_str(profile_json).unwrap_or_default();
    let result = scoring::rerank(&candidates, &profile);
    serde_json::to_string(&result).unwrap_or_default()
}
```

JSON serialization adds overhead but keeps the interface simple. Phase 4 can optimize with shared memory if profiling shows JSON is a bottleneck.

## 8. SDK WASM loader

```ts
// packages/sdk/src/lib/wasm-loader.ts
export async function loadWasmScorer(): Promise<Scorer | null> {
  try {
    const engine = await import("@edgereco/engine");
    await engine.init();
    return createWasmScorer(engine);
  } catch {
    console.info("edgereco: WASM scorer unavailable, using JS fallback");
    return null;
  }
}
```

The loader is a separate module so it can be tested independently with mocked imports.

## 9. Testing strategy (90% coverage target)

### Rust tests (cargo test)

| Test | Coverage target |
|---|---|
| `scoring::score_item` — empty profile | formula branch: popularity + freshness only |
| `scoring::score_item` — full category affinity | category_match contribution |
| `scoring::score_item` — tag averaging | multi-tag mean calculation |
| `scoring::score_item` — empty tags | zero tag contribution |
| `scoring::score_item` — repetition penalty | penalty subtraction |
| `scoring::rerank` — sort order | descending by score |
| `scoring::rerank` — score breakdown sums to finalScore | internal consistency |
| `types` — serde round-trip for each type | JSON de/serialization |
| `lib::rerank` (wasm export) — JSON in/out | end-to-end via exported function |
| Edge cases: empty candidates, empty profile, single item | boundary conditions |

### TypeScript tests (vitest)

| Test | Coverage target |
|---|---|
| Cross-validation: shared fixtures through JS and WASM scorers | identical output, byte-for-byte |
| `wasm-loader`: successful load | scorer returned |
| `wasm-loader`: failed load (import throws) | null returned, no throw |
| `wasm-loader`: WASM init fails | null returned, no throw |
| SDK integration: init with WASM available | uses WASM scorer |
| SDK integration: init with WASM unavailable | falls back to JS |
| All existing reranker tests | unchanged, still pass |
| All existing SDK integration tests | unchanged, still pass |

### E2E (Playwright)

Existing flywheel test passes unchanged. The WASM scorer is active (verified by checking that `@edgereco/engine` is imported in the bundle).

## 10. CI additions

- `build:wasm` step in CI: `wasm-pack build --target web` in `crates/engine/`
- `cargo test` in `crates/engine/`
- Coverage gating: `cargo-tarpaulin` for Rust, `vitest --coverage` for TS
- Regenerate + drift check extended to include `packages/engine/` if applicable

## 11. Acceptance criteria

1. `cargo test` passes in `crates/engine/` with ≥90% line coverage.
2. `wasm-pack build --target web` produces a WASM binary < 500KB.
3. The SDK cross-validation test confirms JS and WASM scorers produce identical `RankedResponse` for 10+ fixture inputs.
4. All 36 existing SDK tests pass unchanged.
5. All 15 existing Python tests pass unchanged.
6. The Playwright flywheel E2E test passes with WASM scorer active.
7. `vitest --coverage` reports ≥90% line coverage for `packages/sdk/`.
8. `pnpm dev` shows the demo working identically to Phase 0.
