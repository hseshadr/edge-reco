# v0.9.0 — Richer interaction signals (favorite · cart · dwell-view)

**TL;DR:** The engine already understands four interaction types
(`click | view | favorite | cart`) with intent-graded weights in all three
layers — but the storefront only ever emits `click`. v0.9.0 adds the missing
emitters: a heart and an add-to-cart button on each product card, plus a
capped dwell-based view signal. Zero engine, backend, weight, or parity
change. The flywheel demo upgrades from "clicks move the rail" to **"a
cart-add moves it more than a click, and what you linger on nudges it
gently."**

## Why now

The hard 75% is already shipped and parity-tested:

| Layer | Where | Status |
|---|---|---|
| Per-session affinity weights | `backend/src/edgereco/reco/signals.py` `INTERACTION_WEIGHTS` | shipped, all 4 types |
| Retrain engagement grading | `backend/src/edgereco/reco/retrain.py` `ENGAGEMENT_WEIGHTS` | shipped, all 4 types |
| Browser session fold | `frontend/packages/edgeproc-browser/src/engine/session.ts` | shipped, parity-tested |
| Event type contract | `domain.ts` `EventType` + backend telemetry models | shipped |
| **UI emitter** | `frontend/app/src/components/Storefront.tsx` | **`click` only — the gap** |

Weight tables for events that can never fire are a latent honesty gap.
Closing it is emitter-only work.

## Decisions (brainstormed 2026-06-10/11)

1. **Signal-first affordances** — heart + add-to-cart buttons with visible
   in-session state (filled heart, header cart-count badge). No favorites
   page, no cart drawer, no checkout. The affordances exist to feed the
   recommender, and the UI says so.
2. **Dwell views: yes, capped** — IntersectionObserver-based, one `view`
   per product per session, silent.
3. **Emitter-only; affinity dynamics untouched** — `_bump`/`bumped` stay
   `min(1.0, current + delta)`. Time-decay and asymptotic bumps stay
   explicitly deferred (see Known simplifications).
4. **Structure: a small `signals/` app module** — emit rules in one
   testable place; `ProductCard` stays presentational.

## Emit rules

| Event | Trigger | Rule | User feedback |
|---|---|---|---|
| `click` | card click (existing) | unchanged | existing toast |
| `favorite` | heart pressed | emit **once per product per session**, on the first transition to favorited; unfavorite clears visual state, emits nothing (negative signals deferred) | toast: "Favorited — strong signal, rail reweighted"; heart fills |
| `cart` | add-to-cart pressed | emit on **every** add (repeated intent = repeated signal) | toast (first add includes "demo: this is a ranking signal — nothing is purchased"); header badge increments |
| `view` | card ≥75% visible (threshold 0.75) for 2 continuous seconds (IntersectionObserver), tab visible | emit **once per product per session**; observer disconnects per product after emit | none — impressions are ambient |

Button presses are exclusive: heart and add-to-cart stop propagation, so a
`favorite`/`cart` press never also emits the card's `click`.

All visible affordance state is per-tab-session, matching the engine session
profile's lifetime: a refresh resets both. That alignment is deliberate and
honest.

## Existing weights (reference — UNCHANGED)

Per-session affinity (`INTERACTION_WEIGHTS`, both tiers):
`cart {cat .25, tag .12, brand .20}` > `favorite {.20, .10, .15}` >
`click {.10, .05, .08}` > `view {.02, .01, .02}`.

Retrain engagement (`ENGAGEMENT_WEIGHTS`): `cart 4.0` > `favorite 3.0` >
`click 1.0` > `view 0.2`.

Headline demo math: **one cart-add beats two clicks on every facet**
(category 0.25 > 0.20, tag 0.12 > 0.10, brand 0.20 > 0.16) — the
deterministic beat the e2e asserts.

## What ships

`frontend/app/src/signals/` (new module):

- `emit.ts` — `emitInteraction(eventType, product)`: applies the per-type
  rule (module-level `Set<productId>` caps for favorite/view), delegates to
  the existing data-client `sendEvent` path, triggers the rail refresh and
  per-type toast copy. Returns whether an event was emitted (drives UI
  state).
- `useDwellViews.ts` — IntersectionObserver hook: threshold 0.75, 2 s
  continuous-visibility timer per card, document-visibility pause,
  per-product disconnect after emit, full cleanup on unmount.
- Toast copy lives with the emit rules, not in components.

Component changes:

- `ProductCard` — heart + add-to-cart buttons (props + callbacks only; no
  signal logic), filled/unfilled heart state.
- `Storefront` — wires callbacks to `emitInteraction`, hosts `useDwellViews`,
  renders the header cart-count badge.

Docs: flywheel sections in README/DEPLOY gain the graded-weights line;
"your clicks never leave your device" copy extended to the new signals.

## Data flow (unchanged path, new entry points)

button/dwell → `emitInteraction` → `sendEvent({event_type, product_id,
timestamp})` → engine session fold (existing weights) → rail re-rank →
uplink enqueue (existing, `VITE_EVENTS_URL`-gated, off by default) →
collector `/events` → `edgereco retrain` (existing grading).

## What does NOT change (invariants)

- `@edgeproc/browser` package: zero changes; parity fixtures byte-stable.
- Backend: zero changes expected — `/events` already types `event_type` as
  the full `EventType`. The plan re-verifies with a test, not trust.
- Scoring formula, weight tables, uplink gating, retrain semantics.
- "Uplink optional & off the inference path" — emit failures are
  fire-and-forget and never block the rail or the app.

## Known simplifications (documented, deliberate)

For recsys-literate readers — this is a reference architecture; the signal
design follows the standard implicit-feedback playbook (intent-graded
engagement, dwell-thresholded capped impressions, fast in-session adaptation
split from slow global retrain), while the learning layer stays deliberately
simple and explainable:

- **Hand-tuned linear weights, not learned models** — explainable ("why?"
  bars), deterministic, parity-testable across tiers. Model quality is not
  the product; the architecture is.
- **No position-bias correction on views** — grid-top cards collect more
  dwell. The tiny view weight (0.02 session / 0.2 retrain) and the
  per-product cap bound the damage.
- **Affinity saturation** — `min(1.0, current + delta)` hard-caps; four
  cart-adds saturate a category for the session. Time-decay / asymptotic
  bumps remain deferred (phase-0 deferral, reaffirmed here).
- **No exploration, no negative signals** — both remain deferred.

## Demo story

- Click three crafts products (today's demo) → rail flips to crafts.
- **New beat:** fresh session, ONE cart-add on a crafts product → rail
  shifts at least as far as two clicks did. Asserted in e2e.
- Flywheel: collector export now shows typed events; `edgereco retrain`
  output already grades them 4/3/1/0.2 — no script change, richer story.

## Testing (TDD, ≥90% on new code)

- **Unit:** emit rules (favorite-once, cart-every-time, view-once,
  unfavorite-emits-nothing); dwell hook with mocked IntersectionObserver +
  fake timers (threshold, 2 s continuity, tab-hidden pause, cleanup); toast
  copy selection.
- **Component:** ProductCard affordances render, fire callbacks, reflect
  state.
- **e2e (Playwright):** favorite and cart each visibly re-rank the rail;
  the one-cart-beats-two-clicks beat; flywheel run asserts typed events
  reach the collector export.
- **Backend:** one integration test asserting `/events` accepts all four
  event types (verification of the zero-change claim).
- **Parity:** suite must pass untouched; fixture files asserted unchanged.

## Error handling

Emit path inherits the existing fire-and-forget pattern (failures logged,
app and rail never blocked). Observers are cleaned up on unmount and after
per-product emit; no leaked timers.

## Out of scope

Favorites/cart pages or persistence, checkout, negative signals, time-decay
or bump-curve changes, any `@edgeproc/browser` or backend change, weight
changes, hero-GIF re-record (later, via the scripted recording pipeline).

## Release

Branch → TDD via subagents → gates (backend untouched but run anyway,
frontend lint/types/unit/e2e) → live browser validation → merge → `v0.9.0`
tag + GitHub release.
