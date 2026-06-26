# Spec — Phase 3: Collaborative filtering + the training/audit flywheel

**Status:** draft for review · **Depends on:** Phase 1 (signed ranking config) + Phase 2 (multi-strategy rails)

## Goal

Close the loop with **item-to-item collaborative filtering** — "Customers who bought X also
bought Y" and "Frequently bought together" — powered by a **co-occurrence matrix computed in
retrain** from collected interaction events and shipped as a **new signed bundle artifact**.
Add an **`edgereco audit`** surface so every ranking change is traceable to the events that
drove it. All inference stays in-tab, signed, parity-locked; zero backend calls.

### User-visible outcome
- **PDP** gains **Customers also bought** and **Frequently bought together** rails (seed = the
  open product), reading co-occurrence neighbors — exactly like a real product page.
- **Flywheel**: local clicks/carts → periodic uplink → `edgereco retrain` recomputes
  popularity **and** co-occurrence → re-signs + republishes → reload, the "also bought" rails
  update. `edgereco audit` explains what changed and why.

## New signed data: `cooccurrence.json`

A sparse top-N neighbor list per product: `{ schema_version, neighbors: { <product_id>:
[{ id, score }, … topN] } }`. Content-addressed + Ed25519-signed in the manifest, exactly
like `products.jsonl` / `ranking_config.json` (added to `BUNDLE_FILES`). Both tiers read it
through the verified sync path; lookups are a local map. Missing file ⇒ co-occurrence
strategies return empty (graceful degrade for older bundles).

**Computation** (pure data transform): for each session, every unordered pair of products
co-engaged (weighted by event type — reuse the retrain `ENGAGEMENT_WEIGHTS`: cart 4, favorite
3, click 1, view 0.2) increments a co-occurrence count; normalize per product (e.g. cosine /
Jaccard over engagement vectors); keep top-N (e.g. 10) neighbors each. Lives in
`reco/cooccurrence.py`, called by retrain.

**Seed bundle co-occurrence (for the static hosted demo, which runs no retrain):** ship a
committed demo co-occurrence derived from a small **committed synthetic session log**
(`examples/source/demo_sessions.jsonl` — plausible co-purchase baskets over the 720-product
catalog), computed by the same `cooccurrence.py`. This is real co-occurrence math on labeled
demo data (not faked), so "also bought" rails are populated on edge-reco.com; a real retrain
regenerates it from genuine events.

## Strategies (config-driven, additive)

Add to `ranking_config.json`'s strategy map (schema_version 2→3, still backward-compatible):
- `also_bought` — label "Customers who bought this also bought", `candidate_policy:
  co_occurrence`, seed required, ranked by co-occurrence score (lightly blended with
  popularity via existing weights).
- `frequently_bought_together` — label "Frequently bought together", `candidate_policy:
  co_occurrence` with a tighter neighbor cut (top 3–4), seed required.

New `CandidatePolicy` enum member `co_occurrence` (both tiers). Candidate pool = the seed's
co-occurrence neighbors; scorer blends co-occurrence score (a new optional
`weights.cooccurrence`, default 0) + popularity. Non-co-occurrence strategies unaffected.

## Retrain + audit (backend)

- **Retrain** (`reco/retrain.py` + `republish.py`): extend `edgereco retrain` to recompute
  `cooccurrence.json` alongside `popularity_score`, then re-sign + republish — still a pure
  DATA transform, both tiers re-rank on sync with no code change. Reuses the existing
  `/events/export` → recompute → republish path and the prebuilt FAISS `vector/` verbatim.
  Republishes to the runtime origin (`.demo-origin`); committed seed + parity fixtures stay
  byte-stable except the intentional new `cooccurrence.json`.
- **Audit** (`edgereco audit`, new CLI): summarize the collected events (counts by type /
  session) and exactly what a retrain changed — top popularity movers (Δ), count of new/changed
  co-occurrence edges, config + bundle version bump. Human-readable table + a structured
  (typed Pydantic) report. This is the "training **and** auditing" surface; read-only, never
  in the inference path.

## Parity

Extend the fixture generator (`gen_strategy_fixture.py` or a new `gen_cooccurrence_fixture.py`)
to emit the co-occurrence strategies' top-k over the real bundle (fixed seed). Browser
reproduces it. Phases 1–2 fixtures stay byte-stable. A unit test pins `cooccurrence.py` output
on a small fixed session set (deterministic).

## Frontend

- App: PDP adds **Customers also bought** + **Frequently bought together** rails via
  `recommend('also_bought', {seed})` / `recommend('frequently_bought_together', {seed})`,
  reusing `RailRow`; guarded (empty/throw ⇒ hidden), so a co-occurrence-less bundle just omits
  them. No new view needed.

## Quality / invariants

- Signed, content-addressed `cooccurrence.json`; fail-closed verify; zero backend calls in the
  inference path. TDD; `python-quality` + `frontend-quality`; ≥90% cov; mypy strict; typed
  boundaries; ≤15-line funcs.
- **Invariant update**: the "Retrain moves data, not the formula" line in CLAUDE.md becomes
  "Retrain moves data — popularity **and** co-occurrence — and may retune the signed ranking
  config; it never changes scoring *code*; both tiers re-rank on sync." (Phase 1 already made
  weights data.)

## Verification

1. `cooccurrence.py` unit-deterministic on a fixed session set; co-occurrence parity green both
   tiers; Phases 1–2 fixtures byte-stable.
2. Backend `poe gate` + frontend gate green (≥90%, mypy strict, biome/tsc).
3. `edgereco retrain` recomputes popularity + co-occurrence, re-signs, republishes; reload ⇒
   "also bought" rails change. `edgereco audit` report matches the events that drove it.
4. Live (real browser): PDP shows populated "Customers also bought" + "Frequently bought
   together" rails seeded by the product; metrics strip 0 backend calls; clean console.
5. Cold-clone build still green (`git clone edge-reco` alone + `uv sync`).
