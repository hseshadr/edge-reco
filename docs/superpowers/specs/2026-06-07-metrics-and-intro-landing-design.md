# Spec: Intro landing + live metrics

**Date:** 2026-06-07
**Status:** Approved design, ready to plan

## TL;DR

Add two things to the Nimbus demo SPA:

1. **An intro landing page** shown before the store. It explains what EdgeReco is,
   why it's good, and shows the headline numbers. One button — "Launch the live
   demo" — boots the engine and enters the store.
2. **A live metrics strip** inside the store. It shows real numbers measured in the
   browser as you use it: recommendation speed, memory, backend calls (0), etc.

The landing **sells**. The store **proves**.

## Why

The user asked for this directly: show the speed and memory so people see why
running discovery in the browser is effective, plus a short intro on why it was
built.

Right now the SPA boots straight into the store with no framing and no numbers. A
visitor can't tell it's fast, private, and backend-free — they just see a store.

## User flow

```
Landing  ──click "Launch"──▶  BootScreen (existing)  ──▶  Store + live MetricsStrip
```

- No router. `App` gets one new boolean: has the user launched yet.
- Before launch: show `<Landing>`. The engine does **not** start.
- On "Launch": run the existing `bootstrap()` → `BootScreen` → `Storefront`.
- The store now also renders the `MetricsStrip`.

## The six metrics

| Metric | On landing | In store (live) | Source / honesty |
| --- | --- | --- | --- |
| Recommendation speed | "~36 ms" (representative) | live per query | wrap `search`/`recommend` with `performance.now()` |
| Backend calls after sync | "0" | live counter | `PerformanceObserver`, count only same-origin edge calls |
| Cold start | "~1.2 s" | this run's real value | time the boot stages |
| Memory | "~22 MB" | live | `performance.memory`; label it "JS heap (Chromium)" |
| Cost / 1k recs | "$0" | static | illustrative; compares architectures, not vendor prices |
| Catalog size | "720 products · 1.6 MB" | 720 from engine | product count is live; bundle size is the known committed value |

**Honesty rules (must hold):**

- Memory is the main-thread JS heap on Chromium only. The model and index live
  off-heap, so this is "indicative," not total RAM. Say so in a tooltip. Hide the
  tile on browsers without `performance.memory`.
- "0 backend calls" counts only same-origin calls to the edge. Product images
  (amazon CDN) and the optional uplink are shown in separate buckets, never folded
  into the "0".
- Cost is labeled "illustrative." No made-up dollar figures.

## Components (match house style: plain CSS in `index.css`, BEM, named exports, `interface` props)

- **`Landing.tsx`** (`landing` block) — wordmark, headline, lede, the 6-tile metric
  band (representative numbers), 4 "why" cards, a 5-step "how it works" strip, and
  the Launch + Architecture buttons. Pure presentation. Reuses the `.boot`
  full-screen shell and the `section-head` headline style.
- **`MetricsStrip.tsx`** (`metrics-strip` block) — compact live strip in the store
  header. Tiles reuse the `clicks-badge` / `sync-badge` look.
- **`metrics/store.ts`** — a small singleton that holds the current numbers, plus a
  `useMetrics()` React hook. Also mirrored to `window.__edgeprocMetrics` so the
  Playwright tests can read it (same pattern as the existing
  `window.__edgeprocDemoTestHooks`).

## Where the numbers come from (instrumentation)

All seams confirmed against the code:

- **Speed:** wrap the `search` and `recommend` exports in `api/client.ts`. Record
  `performance.now()` before/after. `recommend` is synchronous on the main thread,
  so sub-millisecond timings are real.
- **Cold start:** the `App` boot callback already receives every stage. Stamp the
  time at each stage to get total cold start + a per-stage breakdown.
- **0 backend calls:** a `PerformanceObserver` on resource timings. Classify each
  request by host into buckets: edge (the headline, expect 0 after sync), product
  image, optional uplink, other. The classifier is a pure function — easy to test.
- **Memory:** poll `performance.memory.usedJSHeapSize` on a timer.
- **Catalog size:** `catalogInfo()` already returns the product count. Bundle size
  is shown as the known committed value (1.6 MB) to avoid plumbing chunk sizes out
  of the sync Worker.

## Testing (TDD)

**Unit (Vitest):**
- metrics store: record values → hook returns them.
- latency wrapper: returns the engine result and records a positive duration.
- URL→bucket classifier: edge / image / uplink / other (pure function).
- `Landing`: renders headline + tiles; clicking Launch calls `onLaunch`.
- `MetricsStrip`: renders values from the store.

**E2E (Playwright, extend the existing storefront spec):**
- Landing is visible first; the store is not mounted yet.
- Click Launch → boot → store appears.
- After a search, the strip shows a non-empty latency value.
- The "backend calls" counter stays 0 (images/uplink excluded).
- Reuses the deterministic-embedder hook so no model download.

## Out of scope

- No new routing library.
- No change to the engine package (`@edgeproc/browser`).
- No change to the scoring formula or any backend.
- The landing does not boot the engine (representative numbers only).

## Open questions

None blocking. Copy and exact tile styling will be refined during implementation
against the live app.
