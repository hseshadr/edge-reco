# Spec — Phase 2: Multiple recommendation strategies & rails (Amazon-style)

**Status:** draft for review · **Depends on:** Phase 1 (ranking config as signed bundle data, shipped `3ad5526`)

## Goal

Turn the single "Recommended for you" rail into a real, multi-placement storefront. Add
**named recommendation strategies** — each a `(candidate policy + scoring weights)` defined
as signed config in the bundle — and surface them as **stacked rails on the home view** and
**strategy rails on a new product-detail view (PDP)**. Everything stays in-tab, signed, and
parity-locked; no new backend in the inference path.

### User-visible outcome
- **Home**: a vertical stack of horizontally-scrolling rails — **Recommended for you**
  (personalized), **Trending now** (popularity), **New arrivals** (freshness) — each live as
  you interact.
- **PDP** (new): click a product → a detail view with **Similar items** and **Because you
  viewed this** rails (seed = the viewed product), plus **Trending in {category}**.

## Strategies (all from data we already ship)

| key | label | candidate policy | weights lean | seed |
|---|---|---|---|---|
| `for_you` | Recommended for you | affinity-first (today's) | today's exact weights | — |
| `trending` | Trending now | popularity top-N, personalization off | popularity-dominant | — |
| `new_arrivals` | New arrivals | freshness top-N | freshness-dominant | — |
| `similar_items` | Similar items | vector kNN to seed | similarity-dominant + popularity | product |
| `because_viewed` | Because you viewed… | vector kNN to last-viewed | similarity + light affinity | product |

No new data: popularity_score, freshness_score, per-product embeddings, and session
affinities all already exist. Co-purchase ("customers also bought") is **Phase 3** — out of
scope here.

## Config schema (additive, backward-compatible)

Extend `ranking_config.json` **additively** so Phase 1 bundles + fixtures stay byte-stable:

- Keep top-level `scoring_weights` (the `for_you`/default weights — unchanged → parity holds).
- Add an optional `strategies` map. Each entry: `{ label, candidate_policy, weights }`, where
  `weights` is the same `ScoringWeights` shape plus a new optional `similarity: float`.
- Bump `schema_version` 1 → 2. A v1 bundle (no `strategies`) → only `for_you` is available
  and the app shows the single rail (graceful degrade).
- `DEFAULT_RANKING_CONFIG` (both tiers) gains the strategy map with sensible default weights;
  the committed seed bundle ships it. `for_you`'s weights == top-level `scoring_weights`.

Typed both tiers: extend `RankingConfig` (`reco/ranking_config.py`) + `rankingConfig.ts`. No
`Dict[str,Any]`; `candidate_policy` is a closed enum (`affinity_first | popularity |
freshness | vector_similarity`).

## Engine API (both tiers, parity-locked)

- `recommend({ strategy?, seed?, profile?, limit? })` — `strategy` defaults to `for_you`
  (today's behavior; existing calls unchanged). Resolves the strategy's policy + weights from
  the synced config.
- **New seed-based vector kNN** (the one genuinely new primitive):
  - Backend: a FAISS search by a product's reconstructed vector (`search/vector.py` /
    vector index) → `nearest(product_id, k)`.
  - Browser: `VectorIndex.nearest(productId, k)` composing existing `rowVector(row)` +
    cosine `search(queryVec, k)` (excluding the seed itself).
  - Exposed as `SearchEngine.similar(productId, { strategy, limit })`.
- **Scoring**: `vector_similarity` candidates carry a per-candidate `similarity` signal
  (cosine to seed); the scorer adds `+ weights.similarity · similarity`. For non-similarity
  strategies `similarity` is absent/0 — formula reduces to today's. Keep `score_components`
  populated (so the "why?" panel works per strategy).
- `candidate_policy` dispatch lives in `pool.py` / `poolSelection.ts`: `popularity` →
  popularity top-N; `freshness` → freshness top-N; `vector_similarity` → kNN-to-seed;
  `affinity_first` → today's warm/cold logic.

## Frontend

- **PDP view** (new): add a `view` state to `App.tsx`'s state machine (Landing → Boot →
  Storefront ⇄ Product), or a minimal `selectedProductId` in `Storefront`. No router needed —
  stay state-based (keeps the "no deep-link 404" Pages property). Clicking a product card
  opens the PDP; a back affordance returns to the grid. Track `last_viewed` for
  `because_viewed`.
- **Stacked rails on home**: reuse `RecommendRail`, parameterized by `{ strategy, label,
  results }`. New `RailRow` wrapper for horizontal scroll; a `RailStack` lays out For You /
  Trending / New arrivals. Each fetches via `recommend({ strategy })` and refreshes on
  interaction (For You re-ranks live; Trending/New arrivals are stable).
- **PDP rails**: Similar items + Because you viewed (seeded by the open product) + Trending in
  category. Reuse the same rail component.
- The hero loop (click → `applyInteraction` → refresh) is preserved; only For-You-type rails
  re-rank on signal.

## Parity plan

- Extend `backend/scripts/gen_*_fixture.py` to emit a **per-strategy** top-k fixture
  (`strategy_parity.json`): for each strategy (and a fixed seed product for the
  vector-similarity ones), the ordered top-k Python returns over the real bundle.
- Browser test asserts each strategy's top-k matches. Same signed config both sides →
  deterministic. The new `nearest()` primitive gets its own parity case.
- Phase 1 fixtures stay byte-stable (top-level weights unchanged; `for_you` == today).

## Quality / invariants (unchanged from the program)

- Signed config: the strategy map is part of the Ed25519-signed, content-addressed
  `ranking_config.json`. Zero backend calls in the inference path. Fail-closed verification.
- TDD throughout; `python-quality` + `frontend-quality` gates; ≥90% coverage; mypy strict;
  Pydantic/typed boundaries, ≤15-line functions; no default exports / `any`.
- Backward-safe: a config without `strategies` degrades to the single For-You rail.

## Out of scope (Phase 3)

Co-purchase / "customers who bought X also bought Y" (needs a co-occurrence matrix from
retrain) and the `edgereco audit` surface. Cross-session persistence of views/history.

## Verification

1. Per-strategy parity fixtures green both tiers; Phase 1 fixtures byte-stable.
2. Backend `poe gate` + frontend gate green (≥90%, mypy strict, biome/tsc).
3. Live (host Playwright, real browser — OPFS needs a true secure context): home shows 3
   stacked rails; clicking a product opens a PDP with Similar/Because-you-viewed/Trending-in-
   category rails seeded correctly; For-You re-ranks on interaction; metrics strip stays at
   **0 backend calls**; clean console.
4. e2e extended: open PDP → similar-items rail is non-empty and seed-relevant; home stacked
   rails render and the For-You rail re-orders after clicks.
