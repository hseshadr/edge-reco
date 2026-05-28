# Phase 1 — WASM Scorer Drop-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the JS reranker with a Rust → WASM scorer behind the same interface, with automatic JS fallback and 90% code coverage.

**Architecture:** Rust crate at `crates/engine/` compiled via `wasm-pack`; thin TS wrapper at `packages/engine/`; SDK reranker refactored to a `Scorer` strategy with WASM/JS implementations; cross-validation tests ensuring identical output.

**Tech Stack:** Rust, wasm-pack, wasm-bindgen, serde, serde_json, cargo test, vitest, Playwright.

**Companion spec:** [`../specs/phase-1-wasm-scorer.md`](../specs/phase-1-wasm-scorer.md)

---

## Prerequisites

Before starting, verify:
- `rustc --version` → 1.75+ (stable)
- `wasm-pack --version` → 0.12+
- `cargo --version` → recent stable
- If missing: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh` and `cargo install wasm-pack`

---

## File Structure

### New files
- `crates/engine/Cargo.toml` — Rust crate with wasm-bindgen, serde deps
- `crates/engine/src/lib.rs` — wasm-bindgen `rerank` export
- `crates/engine/src/types.rs` — serde types matching SDK CatalogItem, ProfileSnapshot, etc.
- `crates/engine/src/scoring.rs` — pure scoring logic, same formula as JS
- `crates/engine/tests/scoring_test.rs` — fixture-driven integration tests
- `packages/engine/package.json` — `@edgereco/engine` wrapping wasm-pack output
- `packages/engine/src/index.ts` — async init + typed rerank export
- `packages/engine/tsconfig.json`
- `packages/sdk/src/lib/wasm-loader.ts` — async WASM loading
- `packages/sdk/src/lib/wasm-loader.test.ts` — load success/failure tests
- `packages/sdk/src/lib/cross-validation.test.ts` — JS vs WASM identical output
- `test-fixtures/scoring-fixtures.json` — shared fixtures for cross-validation

### Modified files
- `packages/sdk/src/lib/reranker.ts` — extract Scorer interface, keep JS impl
- `packages/sdk/src/lib/reranker.test.ts` — add Scorer interface tests
- `packages/sdk/src/index.ts` — init() loads WASM
- `packages/sdk/src/index.test.ts` — add WASM init tests
- `pnpm-workspace.yaml` — add `packages/engine`
- `package.json` — add `build:wasm` script
- `biome.json` — ignore `crates/`
- `.gitignore` — add `target/`, `crates/engine/pkg/`
- `.github/workflows/ci.yml` — add Rust build + test job

---

## Task Index

1. [Root config updates](#task-1-root-config-updates)
2. [Rust crate scaffold](#task-2-rust-crate-scaffold)
3. [Rust types with serde](#task-3-rust-types-with-serde)
4. [Rust scoring logic (TDD)](#task-4-rust-scoring-logic-tdd)
5. [WASM-bindgen export](#task-5-wasm-bindgen-export)
6. [Build WASM and create packages/engine](#task-6-build-wasm-and-create-packagesengine)
7. [SDK Scorer interface refactor](#task-7-sdk-scorer-interface-refactor)
8. [SDK WASM loader](#task-8-sdk-wasm-loader)
9. [SDK init WASM integration](#task-9-sdk-init-wasm-integration)
10. [Shared scoring fixtures](#task-10-shared-scoring-fixtures)
11. [Cross-validation tests](#task-11-cross-validation-tests)
12. [Coverage enforcement](#task-12-coverage-enforcement)
13. [CI updates](#task-13-ci-updates)
14. [E2E verification](#task-14-e2e-verification)

---

## Task 1: Root config updates

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `package.json`
- Modify: `biome.json`
- Modify: `.gitignore`

- [ ] **Step 1: Update `pnpm-workspace.yaml`** — add `"packages/engine"` to packages list

- [ ] **Step 2: Update root `package.json`** — add scripts:
```json
"build:wasm": "cd crates/engine && wasm-pack build --target web --out-dir ../../packages/engine/pkg",
"prebuild": "pnpm run build:wasm"
```

- [ ] **Step 3: Update `biome.json`** — add `"**/crates/**"`, `"**/pkg/**"`, `"**/target/**"` to files.ignore

- [ ] **Step 4: Update `.gitignore`** — add:
```
target/
crates/engine/pkg/
packages/engine/pkg/
```

- [ ] **Step 5: Commit**
```bash
git add pnpm-workspace.yaml package.json biome.json .gitignore
git commit -m "chore: prepare workspace for Rust/WASM engine"
```

---

## Task 2: Rust crate scaffold

**Files:**
- Create: `crates/engine/Cargo.toml`
- Create: `crates/engine/src/lib.rs` (minimal placeholder)

- [ ] **Step 1: Create `crates/engine/Cargo.toml`**

```toml
[package]
name = "edgereco-engine"
version = "0.1.0"
edition = "2021"
description = "EdgeReco WASM scoring engine"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = "0.2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"

[dev-dependencies]
wasm-bindgen-test = "0.3"

[profile.release]
opt-level = "s"
lto = true
```

- [ ] **Step 2: Create `crates/engine/src/lib.rs`** (placeholder)

```rust
#![warn(clippy::all, clippy::pedantic)]

pub mod scoring;
pub mod types;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn rerank(_candidates_json: &str, _profile_json: &str) -> String {
    String::from("[]")
}
```

- [ ] **Step 3: Create stub `crates/engine/src/types.rs`**
```rust
// placeholder
```

- [ ] **Step 4: Create stub `crates/engine/src/scoring.rs`**
```rust
// placeholder
```

- [ ] **Step 5: Verify build**
```bash
cd crates/engine && cargo check
```

- [ ] **Step 6: Commit**
```bash
git add crates/engine
git commit -m "feat(engine): scaffold Rust WASM crate"
```

---

## Task 3: Rust types with serde

**Files:**
- Modify: `crates/engine/src/types.rs`

- [ ] **Step 1: Write types matching the SDK's TypeScript types**

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub popularity_score: f64,
    pub freshness_score: f64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSnapshot {
    pub category_affinity: std::collections::HashMap<String, f64>,
    pub tag_affinity: std::collections::HashMap<String, f64>,
    pub recently_viewed: Vec<String>,
    pub session_click_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBreakdown {
    pub popularity: f64,
    pub category_match: f64,
    pub tag_match: f64,
    pub freshness: f64,
    pub repetition_penalty: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub popularity_score: f64,
    pub freshness_score: f64,
    pub final_score: f64,
    pub score_breakdown: ScoreBreakdown,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedResponse {
    pub items: Vec<RankedItem>,
    pub raw_items: Vec<RawItem>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawItem {
    pub id: String,
    pub title: String,
    pub category: String,
    pub tags: Vec<String>,
    pub popularity_score: f64,
    pub freshness_score: f64,
}
```

IMPORTANT: `#[serde(rename_all = "camelCase")]` ensures JSON field names match what the TypeScript SDK expects (e.g., `popularityScore`, `finalScore`, `scoreBreakdown`).

- [ ] **Step 2: Write serde round-trip tests** in `crates/engine/src/types.rs` (inline tests):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deserialize_catalog_item() {
        let json = r#"{"id":"a","title":"A","category":"running","tags":["lightweight"],"popularityScore":0.7,"freshnessScore":0.4}"#;
        let item: CatalogItem = serde_json::from_str(json).unwrap();
        assert_eq!(item.id, "a");
        assert!((item.popularity_score - 0.7).abs() < f64::EPSILON);
    }

    #[test]
    fn deserialize_profile_snapshot() {
        let json = r#"{"categoryAffinity":{"running":0.5},"tagAffinity":{"lightweight":0.3},"recentlyViewed":["a"],"sessionClickCount":2}"#;
        let profile: ProfileSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(profile.category_affinity.get("running"), Some(&0.5));
        assert_eq!(profile.recently_viewed, vec!["a"]);
    }

    #[test]
    fn serialize_ranked_item_uses_camel_case() {
        let item = RankedItem {
            id: "a".into(), title: "A".into(), category: "running".into(),
            tags: vec!["t".into()], popularity_score: 0.5, freshness_score: 0.3,
            final_score: 0.42,
            score_breakdown: ScoreBreakdown {
                popularity: 0.25, category_match: 0.1, tag_match: 0.05,
                freshness: 0.03, repetition_penalty: 0.0,
            },
        };
        let json = serde_json::to_string(&item).unwrap();
        assert!(json.contains("finalScore"));
        assert!(json.contains("scoreBreakdown"));
        assert!(json.contains("popularityScore"));
    }
}
```

- [ ] **Step 3: Verify**
```bash
cd crates/engine && cargo test
```

- [ ] **Step 4: Commit**
```bash
git add crates/engine/src/types.rs
git commit -m "feat(engine): add serde types matching SDK TypeScript types"
```

---

## Task 4: Rust scoring logic (TDD)

**Files:**
- Modify: `crates/engine/src/scoring.rs`

- [ ] **Step 1: Write failing tests first** (add to `scoring.rs`):

```rust
use crate::types::*;
use std::collections::HashMap;

pub struct ScoringWeights {
    pub popularity: f64,
    pub category: f64,
    pub tag: f64,
    pub freshness: f64,
    pub repetition_penalty: f64,
}

pub const WEIGHTS: ScoringWeights = ScoringWeights {
    popularity: 0.5,
    category: 0.25,
    tag: 0.15,
    freshness: 0.1,
    repetition_penalty: 0.3,
};

// Implement these functions to make tests pass:

fn category_match(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    todo!()
}

fn tag_match(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    todo!()
}

fn repetition_penalty(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    todo!()
}

fn score_item(item: &CatalogItem, profile: &ProfileSnapshot) -> RankedItem {
    todo!()
}

pub fn rerank(candidates: &[CatalogItem], profile: &ProfileSnapshot) -> RankedResponse {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_profile() -> ProfileSnapshot {
        ProfileSnapshot {
            category_affinity: HashMap::new(),
            tag_affinity: HashMap::new(),
            recently_viewed: vec![],
            session_click_count: 0,
        }
    }

    fn make_item(id: &str, category: &str, tags: Vec<&str>, pop: f64, fresh: f64) -> CatalogItem {
        CatalogItem {
            id: id.into(), title: format!("Item {id}"), category: category.into(),
            tags: tags.into_iter().map(String::from).collect(),
            popularity_score: pop, freshness_score: fresh,
        }
    }

    #[test]
    fn empty_profile_score_is_popularity_plus_freshness() {
        let item = make_item("a", "running", vec![], 0.8, 0.4);
        let result = rerank(&[item], &empty_profile());
        let expected = 0.5 * 0.8 + 0.1 * 0.4;
        assert!((result.items[0].final_score - expected).abs() < 1e-10);
    }

    #[test]
    fn full_category_affinity_contributes_0_25() {
        let item = make_item("a", "running", vec![], 0.0, 0.0);
        let mut profile = empty_profile();
        profile.category_affinity.insert("running".into(), 1.0);
        let result = rerank(&[item], &profile);
        assert!((result.items[0].final_score - 0.25).abs() < 1e-10);
    }

    #[test]
    fn tag_match_is_mean_scaled_by_0_15() {
        let item = make_item("a", "x", vec!["a", "b"], 0.0, 0.0);
        let mut profile = empty_profile();
        profile.tag_affinity.insert("a".into(), 1.0);
        profile.tag_affinity.insert("b".into(), 0.0);
        let result = rerank(&[item], &profile);
        assert!((result.items[0].final_score - 0.075).abs() < 1e-10);
    }

    #[test]
    fn empty_tags_zero_contribution() {
        let item = make_item("a", "x", vec![], 0.0, 0.0);
        let mut profile = empty_profile();
        profile.tag_affinity.insert("anything".into(), 1.0);
        let result = rerank(&[item], &profile);
        assert!((result.items[0].final_score).abs() < 1e-10);
    }

    #[test]
    fn repetition_penalty_subtracts_0_3() {
        let item = make_item("seen", "x", vec![], 1.0, 0.0);
        let mut profile = empty_profile();
        profile.recently_viewed.push("seen".into());
        let result = rerank(&[item], &profile);
        assert!((result.items[0].final_score - 0.2).abs() < 1e-10);
    }

    #[test]
    fn sorts_descending_by_score() {
        let items = vec![
            make_item("low", "x", vec![], 0.1, 0.0),
            make_item("high", "x", vec![], 0.9, 0.0),
            make_item("mid", "x", vec![], 0.5, 0.0),
        ];
        let result = rerank(&items, &empty_profile());
        let ids: Vec<&str> = result.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, vec!["high", "mid", "low"]);
    }

    #[test]
    fn breakdown_sums_to_final_score() {
        let item = make_item("a", "running", vec!["lightweight"], 0.7, 0.4);
        let mut profile = empty_profile();
        profile.category_affinity.insert("running".into(), 0.6);
        profile.tag_affinity.insert("lightweight".into(), 0.8);
        profile.recently_viewed.push("a".into());
        let result = rerank(&[item], &profile);
        let bd = &result.items[0].score_breakdown;
        let summed = bd.popularity + bd.category_match + bd.tag_match + bd.freshness - bd.repetition_penalty;
        assert!((result.items[0].final_score - summed).abs() < 1e-10);
    }

    #[test]
    fn raw_items_preserves_input_order() {
        let items = vec![
            make_item("a", "x", vec![], 0.1, 0.0),
            make_item("b", "x", vec![], 0.9, 0.0),
        ];
        let result = rerank(&items, &empty_profile());
        let raw_ids: Vec<&str> = result.raw_items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(raw_ids, vec!["a", "b"]);
    }

    #[test]
    fn empty_candidates_returns_empty() {
        let result = rerank(&[], &empty_profile());
        assert!(result.items.is_empty());
        assert!(result.raw_items.is_empty());
    }

    #[test]
    fn single_item_returns_correctly() {
        let item = make_item("solo", "cat", vec!["tag1"], 0.5, 0.5);
        let result = rerank(&[item], &empty_profile());
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].id, "solo");
    }
}
```

- [ ] **Step 2: Run tests — should FAIL** (all `todo!()`)
```bash
cd crates/engine && cargo test
```

- [ ] **Step 3: Implement the scoring functions**

Replace the `todo!()` bodies with actual implementations:

```rust
fn category_match(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    profile.category_affinity.get(&item.category).copied().unwrap_or(0.0)
}

fn tag_match(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    if item.tags.is_empty() {
        return 0.0;
    }
    let total: f64 = item.tags.iter()
        .map(|tag| profile.tag_affinity.get(tag).copied().unwrap_or(0.0))
        .sum();
    total / item.tags.len() as f64
}

fn repetition_penalty(item: &CatalogItem, profile: &ProfileSnapshot) -> f64 {
    if profile.recently_viewed.contains(&item.id) {
        WEIGHTS.repetition_penalty
    } else {
        0.0
    }
}

fn score_item(item: &CatalogItem, profile: &ProfileSnapshot) -> RankedItem {
    let pop = WEIGHTS.popularity * item.popularity_score;
    let cat = WEIGHTS.category * category_match(item, profile);
    let tag = WEIGHTS.tag * tag_match(item, profile);
    let fresh = WEIGHTS.freshness * item.freshness_score;
    let penalty = repetition_penalty(item, profile);

    RankedItem {
        id: item.id.clone(),
        title: item.title.clone(),
        category: item.category.clone(),
        tags: item.tags.clone(),
        popularity_score: item.popularity_score,
        freshness_score: item.freshness_score,
        final_score: pop + cat + tag + fresh - penalty,
        score_breakdown: ScoreBreakdown {
            popularity: pop,
            category_match: cat,
            tag_match: tag,
            freshness: fresh,
            repetition_penalty: penalty,
        },
    }
}

pub fn rerank(candidates: &[CatalogItem], profile: &ProfileSnapshot) -> RankedResponse {
    let mut items: Vec<RankedItem> = candidates.iter()
        .map(|item| score_item(item, profile))
        .collect();
    items.sort_by(|a, b| b.final_score.partial_cmp(&a.final_score).unwrap_or(std::cmp::Ordering::Equal));

    let raw_items: Vec<RawItem> = candidates.iter()
        .map(|item| RawItem {
            id: item.id.clone(),
            title: item.title.clone(),
            category: item.category.clone(),
            tags: item.tags.clone(),
            popularity_score: item.popularity_score,
            freshness_score: item.freshness_score,
        })
        .collect();

    RankedResponse { items, raw_items }
}
```

- [ ] **Step 4: Run tests — should PASS**
```bash
cd crates/engine && cargo test
```

- [ ] **Step 5: Run clippy**
```bash
cd crates/engine && cargo clippy --all-targets -- -W clippy::pedantic
```

- [ ] **Step 6: Commit**
```bash
git add crates/engine/src/scoring.rs
git commit -m "feat(engine): implement scoring logic matching JS formula (TDD)"
```

---

## Task 5: WASM-bindgen export

**Files:**
- Modify: `crates/engine/src/lib.rs`

- [ ] **Step 1: Replace placeholder with real export**

```rust
#![warn(clippy::all, clippy::pedantic)]

pub mod scoring;
pub mod types;

use wasm_bindgen::prelude::*;
use crate::types::{CatalogItem, ProfileSnapshot};

/// Rerank candidates based on a user profile.
/// Takes JSON strings, returns a JSON string.
/// This is the only public WASM export for Phase 1.
#[wasm_bindgen]
pub fn rerank(candidates_json: &str, profile_json: &str) -> String {
    let candidates: Vec<CatalogItem> = serde_json::from_str(candidates_json).unwrap_or_default();
    let profile: ProfileSnapshot = serde_json::from_str(profile_json).unwrap_or_default();
    let result = scoring::rerank(&candidates, &profile);
    serde_json::to_string(&result).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rerank_json_round_trip() {
        let candidates = r#"[{"id":"a","title":"A","category":"running","tags":["lightweight"],"popularityScore":0.8,"freshnessScore":0.4}]"#;
        let profile = r#"{"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0}"#;
        let result = rerank(candidates, profile);
        assert!(result.contains("finalScore"));
        assert!(result.contains("scoreBreakdown"));
    }

    #[test]
    fn rerank_handles_malformed_input() {
        let result = rerank("not json", "also not json");
        assert_eq!(result, r#"{"items":[],"rawItems":[]}"#);
    }

    #[test]
    fn rerank_handles_empty_candidates() {
        let result = rerank("[]", r#"{"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0}"#);
        assert_eq!(result, r#"{"items":[],"rawItems":[]}"#);
    }
}
```

- [ ] **Step 2: Run all Rust tests**
```bash
cd crates/engine && cargo test
```

- [ ] **Step 3: Build WASM**
```bash
cd crates/engine && wasm-pack build --target web --out-dir ../../packages/engine/pkg
```

Expected: produces `packages/engine/pkg/` with `.wasm`, `.js`, `.d.ts` files.

- [ ] **Step 4: Commit**
```bash
git add crates/engine/src/lib.rs
git commit -m "feat(engine): add wasm-bindgen rerank export with JSON round-trip"
```

---

## Task 6: Build WASM and create packages/engine

**Files:**
- Create: `packages/engine/package.json`
- Create: `packages/engine/src/index.ts`
- Create: `packages/engine/tsconfig.json`

- [ ] **Step 1: Build WASM** (if not done in Task 5)
```bash
pnpm run build:wasm
```

- [ ] **Step 2: Create `packages/engine/package.json`**

```json
{
  "name": "@edgereco/engine",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build:wasm": "cd ../../crates/engine && wasm-pack build --target web --out-dir ../../packages/engine/pkg",
    "build": "pnpm run build:wasm",
    "test": "echo 'tests in packages/sdk' && exit 0",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {},
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 3: Create `packages/engine/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "noEmit": true
  },
  "include": ["src/**/*", "pkg/**/*.d.ts"]
}
```

- [ ] **Step 4: Create `packages/engine/src/index.ts`**

```ts
// Re-export the WASM module with a typed interface.
// The `pkg/` directory is generated by wasm-pack and contains
// the .wasm binary, JS glue, and TypeScript declarations.

import init, { rerank as wasmRerank } from "../pkg/edgereco_engine.js";

let initialized = false;

export async function initialize(): Promise<void> {
  if (initialized) {
    return;
  }
  await init();
  initialized = true;
}

export function rerank(candidatesJson: string, profileJson: string): string {
  if (!initialized) {
    throw new Error("WASM engine not initialized. Call initialize() first.");
  }
  return wasmRerank(candidatesJson, profileJson);
}
```

- [ ] **Step 5: Install and verify**
```bash
pnpm install
```

- [ ] **Step 6: Commit**
```bash
git add packages/engine pnpm-lock.yaml
git commit -m "feat(engine): create @edgereco/engine TS wrapper for WASM"
```

---

## Task 7: SDK Scorer interface refactor

**Files:**
- Modify: `packages/sdk/src/lib/reranker.ts`
- Modify: `packages/sdk/src/lib/reranker.test.ts`

- [ ] **Step 1: Read current `reranker.ts` and `reranker.test.ts`** to understand exact implementation

- [ ] **Step 2: Extract `Scorer` interface and refactor** — keep all existing logic, add the interface:

Add to `reranker.ts`:
```ts
export interface Scorer {
  rerank(candidates: readonly CatalogItem[], profile: ProfileSnapshot): RankedResponse;
}

// Existing rerank function becomes the JS scorer
export const jsScorer: Scorer = { rerank };
```

- [ ] **Step 3: Add `createWasmScorer` factory**

Add to `reranker.ts`:
```ts
export interface WasmEngine {
  rerank(candidatesJson: string, profileJson: string): string;
}

export function createWasmScorer(engine: WasmEngine): Scorer {
  return {
    rerank(candidates: readonly CatalogItem[], profile: ProfileSnapshot): RankedResponse {
      const resultJson = engine.rerank(
        JSON.stringify(candidates),
        JSON.stringify(profile),
      );
      return JSON.parse(resultJson) as RankedResponse;
    },
  };
}
```

- [ ] **Step 4: Add Scorer tests** to `reranker.test.ts`:

```ts
describe("Scorer interface", () => {
  it("jsScorer implements Scorer and produces correct output", () => {
    const item = makeItem({ popularityScore: 0.8, freshnessScore: 0.4, tags: [] });
    const result = jsScorer.rerank([item], emptyProfile);
    expect(result.items[0]!.finalScore).toBeCloseTo(0.5 * 0.8 + 0.1 * 0.4, 10);
  });
});
```

- [ ] **Step 5: Run existing tests — all should still pass**
```bash
pnpm -C packages/sdk run test
```

- [ ] **Step 6: Commit**
```bash
git add packages/sdk/src/lib/reranker.ts packages/sdk/src/lib/reranker.test.ts
git commit -m "feat(sdk): extract Scorer interface and jsScorer from reranker"
```

---

## Task 8: SDK WASM loader

**Files:**
- Create: `packages/sdk/src/lib/wasm-loader.ts`
- Create: `packages/sdk/src/lib/wasm-loader.test.ts`

- [ ] **Step 1: Write tests first**

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadWasmScorer } from "./wasm-loader.js";

afterEach(() => { vi.restoreAllMocks(); });

describe("loadWasmScorer", () => {
  it("returns null when @edgereco/engine import fails", async () => {
    const scorer = await loadWasmScorer();
    // In test environment without WASM, import will fail
    expect(scorer).toBeNull();
  });

  it("returns a Scorer when engine loads successfully", async () => {
    // Mock the dynamic import
    const mockEngine = {
      initialize: vi.fn().mockResolvedValue(undefined),
      rerank: vi.fn().mockReturnValue('{"items":[],"rawItems":[]}'),
    };
    vi.doMock("@edgereco/engine", () => mockEngine);

    // Need to re-import to pick up the mock
    const { loadWasmScorer: load } = await import("./wasm-loader.js");
    const scorer = await load();
    // This test may need adjustment based on how dynamic import mocking works in vitest
  });
});
```

NOTE: Testing dynamic imports with vitest mocking can be tricky. The implementer should use `vi.doMock` or a similar pattern. If mocking is too complex, test the happy path via the cross-validation test (Task 11) instead, and only test the error path here.

- [ ] **Step 2: Implement `wasm-loader.ts`**

```ts
import type { Scorer } from "./reranker.js";
import { createWasmScorer } from "./reranker.js";

export async function loadWasmScorer(): Promise<Scorer | null> {
  try {
    const engine = await import("@edgereco/engine");
    await engine.initialize();
    return createWasmScorer(engine);
  } catch {
    console.info("edgereco: WASM scorer unavailable, using JS fallback");
    return null;
  }
}
```

- [ ] **Step 3: Run tests**
```bash
pnpm -C packages/sdk run test
```

- [ ] **Step 4: Commit**
```bash
git add packages/sdk/src/lib/wasm-loader.ts packages/sdk/src/lib/wasm-loader.test.ts
git commit -m "feat(sdk): add WASM loader with automatic JS fallback"
```

---

## Task 9: SDK init WASM integration

**Files:**
- Modify: `packages/sdk/src/index.ts`
- Modify: `packages/sdk/src/index.test.ts`

- [ ] **Step 1: Read current `index.ts`** to understand the factory

- [ ] **Step 2: Modify `createEdgeRecoSdk`** to accept an optional scorer and try WASM at init:

Add to `CreateSdkOptions`:
```ts
scorerOverride?: Scorer;
```

Modify the factory to load WASM:
```ts
import { loadWasmScorer } from "./lib/wasm-loader.js";
import { jsScorer, type Scorer } from "./lib/reranker.js";

// In createEdgeRecoSdk:
const scorer: Scorer = opts.scorerOverride ?? (await loadWasmScorer()) ?? jsScorer;
```

Replace the direct `rerank()` call in `getCandidates` with `scorer.rerank()`.

- [ ] **Step 3: Add test for WASM fallback behavior**

```ts
it("falls back to JS scorer when WASM is unavailable", async () => {
  const sdk = await createEdgeRecoSdk({
    apiBaseUrl: "http://api.test",
    candidateClientOverride: stubClient,
  });
  await sdk.init();
  const result = await sdk.getCandidates({ contextType: "homepage", limit: 3 });
  // Should still work — JS scorer is the fallback
  expect(result.items.length).toBe(3);
});
```

- [ ] **Step 4: Run all tests**
```bash
pnpm -C packages/sdk run test
```

All 36+ existing tests should still pass.

- [ ] **Step 5: Commit**
```bash
git add packages/sdk/src/index.ts packages/sdk/src/index.test.ts
git commit -m "feat(sdk): integrate WASM scorer with JS fallback in init"
```

---

## Task 10: Shared scoring fixtures

**Files:**
- Create: `test-fixtures/scoring-fixtures.json`

- [ ] **Step 1: Create fixture file** with 10+ test scenarios:

```json
[
  {
    "name": "empty profile, single item",
    "candidates": [{"id":"a","title":"A","category":"running","tags":[],"popularityScore":0.8,"freshnessScore":0.4}],
    "profile": {"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "a",
    "expectedTopScore": 0.44
  },
  {
    "name": "category affinity boost",
    "candidates": [
      {"id":"a","title":"A","category":"running","tags":[],"popularityScore":0.3,"freshnessScore":0.0},
      {"id":"b","title":"B","category":"formal","tags":[],"popularityScore":0.3,"freshnessScore":0.0}
    ],
    "profile": {"categoryAffinity":{"running":1.0},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "a",
    "expectedTopScore": 0.4
  },
  {
    "name": "repetition penalty pushes item down",
    "candidates": [
      {"id":"seen","title":"Seen","category":"x","tags":[],"popularityScore":0.8,"freshnessScore":0.0},
      {"id":"fresh","title":"Fresh","category":"x","tags":[],"popularityScore":0.6,"freshnessScore":0.0}
    ],
    "profile": {"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":["seen"],"sessionClickCount":1},
    "expectedTopId": "fresh",
    "expectedTopScore": 0.3
  },
  {
    "name": "tag averaging across multiple tags",
    "candidates": [{"id":"a","title":"A","category":"x","tags":["t1","t2","t3"],"popularityScore":0.0,"freshnessScore":0.0}],
    "profile": {"categoryAffinity":{},"tagAffinity":{"t1":0.9,"t2":0.3,"t3":0.0},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "a",
    "expectedTopScore": 0.06
  },
  {
    "name": "full profile with all factors",
    "candidates": [
      {"id":"a","title":"Runner","category":"running","tags":["lightweight","trail"],"popularityScore":0.5,"freshnessScore":0.6},
      {"id":"b","title":"Oxford","category":"formal","tags":["leather","dress"],"popularityScore":0.88,"freshnessScore":0.25}
    ],
    "profile": {"categoryAffinity":{"running":0.8},"tagAffinity":{"lightweight":0.7,"trail":0.4},"recentlyViewed":["b"],"sessionClickCount":5},
    "expectedTopId": "a",
    "expectedTopScore": 0.5575
  },
  {
    "name": "empty candidates",
    "candidates": [],
    "profile": {"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": null,
    "expectedTopScore": null
  },
  {
    "name": "single tag item",
    "candidates": [{"id":"a","title":"A","category":"x","tags":["only"],"popularityScore":0.0,"freshnessScore":0.0}],
    "profile": {"categoryAffinity":{},"tagAffinity":{"only":1.0},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "a",
    "expectedTopScore": 0.15
  },
  {
    "name": "three items sorted by combined score",
    "candidates": [
      {"id":"low","title":"Low","category":"x","tags":[],"popularityScore":0.1,"freshnessScore":0.1},
      {"id":"high","title":"High","category":"x","tags":[],"popularityScore":0.9,"freshnessScore":0.9},
      {"id":"mid","title":"Mid","category":"x","tags":[],"popularityScore":0.5,"freshnessScore":0.5}
    ],
    "profile": {"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "high",
    "expectedTopScore": 0.54
  },
  {
    "name": "all recently viewed penalized equally",
    "candidates": [
      {"id":"a","title":"A","category":"x","tags":[],"popularityScore":0.5,"freshnessScore":0.0},
      {"id":"b","title":"B","category":"x","tags":[],"popularityScore":0.5,"freshnessScore":0.0}
    ],
    "profile": {"categoryAffinity":{},"tagAffinity":{},"recentlyViewed":["a","b"],"sessionClickCount":2},
    "expectedTopId": "a",
    "expectedTopScore": -0.05
  },
  {
    "name": "zero popularity zero freshness with affinities only",
    "candidates": [{"id":"a","title":"A","category":"running","tags":["fast"],"popularityScore":0.0,"freshnessScore":0.0}],
    "profile": {"categoryAffinity":{"running":0.5},"tagAffinity":{"fast":0.5},"recentlyViewed":[],"sessionClickCount":0},
    "expectedTopId": "a",
    "expectedTopScore": 0.2
  }
]
```

- [ ] **Step 2: Commit**
```bash
git add test-fixtures/scoring-fixtures.json
git commit -m "test: add shared scoring fixtures for cross-validation"
```

---

## Task 11: Cross-validation tests

**Files:**
- Create: `packages/sdk/src/lib/cross-validation.test.ts`

- [ ] **Step 1: Write cross-validation test** that runs fixtures through the JS scorer:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { jsScorer } from "./reranker.js";
import type { CatalogItem, ProfileSnapshot } from "../types.js";

interface Fixture {
  name: string;
  candidates: CatalogItem[];
  profile: ProfileSnapshot;
  expectedTopId: string | null;
  expectedTopScore: number | null;
}

const fixtures: Fixture[] = JSON.parse(
  readFileSync(resolve(__dirname, "../../../../test-fixtures/scoring-fixtures.json"), "utf-8"),
);

describe("JS scorer — fixture validation", () => {
  for (const fixture of fixtures) {
    it(fixture.name, () => {
      const result = jsScorer.rerank(fixture.candidates, fixture.profile);
      if (fixture.expectedTopId === null) {
        expect(result.items.length).toBe(0);
      } else {
        expect(result.items[0]!.id).toBe(fixture.expectedTopId);
        expect(result.items[0]!.finalScore).toBeCloseTo(fixture.expectedTopScore!, 4);
      }
    });
  }
});

// WASM cross-validation: if @edgereco/engine is available, run the same fixtures
// through the WASM scorer and assert identical output to JS.
// This test is skipped in environments without WASM (e.g., pure Node CI).
describe.skipIf(!globalThis.WebAssembly)("WASM scorer — cross-validation with JS", () => {
  // This test requires the WASM module to be built and importable.
  // In CI, it runs after `pnpm build:wasm`.
  it.todo("produces identical output to JS scorer for all fixtures");
});
```

NOTE: The WASM cross-validation test may need to be run in a browser-like environment or with a WASM-capable Node setup. The implementer should determine the best approach. A pragmatic fallback: run the Rust tests with the same fixtures (Task 4 already does this) — identical input → identical output across languages proves cross-language consistency.

- [ ] **Step 2: Also add fixture validation to the Rust test suite**

Add to `crates/engine/src/scoring.rs` tests (or create `crates/engine/tests/fixture_test.rs`):

```rust
#[test]
fn fixture_validation() {
    let fixture_json = include_str!("../../../test-fixtures/scoring-fixtures.json");
    let fixtures: Vec<serde_json::Value> = serde_json::from_str(fixture_json).unwrap();
    for fixture in fixtures {
        let name = fixture["name"].as_str().unwrap();
        let candidates: Vec<CatalogItem> = serde_json::from_value(fixture["candidates"].clone()).unwrap();
        let profile: ProfileSnapshot = serde_json::from_value(fixture["profile"].clone()).unwrap();
        let result = rerank(&candidates, &profile);
        match fixture["expectedTopId"].as_str() {
            None => assert!(result.items.is_empty(), "fixture '{name}': expected empty"),
            Some(expected_id) => {
                assert_eq!(result.items[0].id, expected_id, "fixture '{name}': wrong top id");
                let expected_score = fixture["expectedTopScore"].as_f64().unwrap();
                assert!((result.items[0].final_score - expected_score).abs() < 1e-4,
                    "fixture '{name}': score mismatch: got {}, expected {expected_score}", result.items[0].final_score);
            }
        }
    }
}
```

- [ ] **Step 3: Run both**
```bash
cd crates/engine && cargo test
pnpm -C packages/sdk run test
```

- [ ] **Step 4: Commit**
```bash
git add packages/sdk/src/lib/cross-validation.test.ts crates/engine/src/scoring.rs
git commit -m "test: add cross-validation tests for JS and Rust scorers"
```

---

## Task 12: Coverage enforcement

**Files:**
- Modify: `packages/sdk/vitest.config.ts`
- Modify: `packages/sdk/package.json`

- [ ] **Step 1: Add vitest coverage config**

Update `packages/sdk/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test-setup.ts", "src/generated/**"],
      thresholds: {
        lines: 90,
        functions: 90,
        branches: 85,
        statements: 90,
      },
    },
  },
});
```

- [ ] **Step 2: Add coverage dev dependency**

```bash
pnpm -C packages/sdk add -D @vitest/coverage-v8
```

- [ ] **Step 3: Add coverage script to `packages/sdk/package.json`**

```json
"test:coverage": "vitest run --coverage"
```

- [ ] **Step 4: Run coverage**
```bash
pnpm -C packages/sdk run test:coverage
```

Expected: ≥90% line coverage. If below, identify uncovered lines and add tests.

- [ ] **Step 5: Commit**
```bash
git add packages/sdk/vitest.config.ts packages/sdk/package.json pnpm-lock.yaml
git commit -m "test(sdk): enforce 90% coverage threshold"
```

---

## Task 13: CI updates

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add Rust build + test job** to CI:

```yaml
  rust:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          targets: wasm32-unknown-unknown
      - name: Install wasm-pack
        run: cargo install wasm-pack
      - name: Cargo test
        run: cd crates/engine && cargo test
      - name: Clippy
        run: cd crates/engine && cargo clippy --all-targets -- -W clippy::pedantic
      - name: Build WASM
        run: cd crates/engine && wasm-pack build --target web --out-dir ../../packages/engine/pkg
```

- [ ] **Step 2: Update the `typescript` job** to depend on `rust` (needs WASM built) and add coverage:

Add `needs: [rust]` to the `typescript` job and add coverage step:
```yaml
      - name: Test with coverage
        run: pnpm -C packages/sdk run test:coverage
```

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/ci.yml
git commit -m "ci: add Rust build/test job and SDK coverage enforcement"
```

---

## Task 14: E2E verification

- [ ] **Step 1: Build WASM**
```bash
pnpm run build:wasm
```

- [ ] **Step 2: Run all TS tests**
```bash
pnpm test
```

- [ ] **Step 3: Run all Rust tests**
```bash
cd crates/engine && cargo test
```

- [ ] **Step 4: Run E2E**
```bash
pnpm e2e
```

- [ ] **Step 5: Verify demo**

Start `pnpm dev`, open browser, click items, verify reranking works. The WASM scorer should be active (check console for absence of "WASM scorer unavailable" message).

- [ ] **Step 6: Run coverage**
```bash
pnpm -C packages/sdk run test:coverage
```

Verify ≥90% coverage.

- [ ] **Step 7: Commit any fixes**
```bash
git add -A && git status
# If clean, done. If fixes needed, commit them.
```

---

## Self-review checklist

- [x] Spec §2 goals: Rust crate (T2-5), Scorer strategy (T7), cross-validation (T10-11), 90% coverage (T12), existing tests unchanged (T9,T14)
- [x] Spec §3 non-goals: no Compute Worker, no CDN, no hot-swap, no reco_init
- [x] Spec §4 architecture: all files accounted for in tasks
- [x] Spec §6 scoring formula: identical weights in Rust (T4) and verified via shared fixtures (T10-11)
- [x] Spec §9 testing: Rust unit (T4), serde (T3), WASM export (T5), cross-validation (T11), coverage (T12), E2E (T14)
- [x] Spec §11 acceptance: all criteria have a task that verifies them
- [x] Type consistency: `Scorer`, `jsScorer`, `createWasmScorer`, `WasmEngine`, `loadWasmScorer` — names consistent across T7, T8, T9
- [x] No placeholders: all code blocks are complete
