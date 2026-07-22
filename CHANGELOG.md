# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.12.0] — 2026-07-21

### Fixed
- **Small signal-family text now holds WCAG-AA 4.5:1**: `.metrics-strip__value`
  (14px metric values) and `.card__pick` (12px hover cue) render with the
  existing `--signal-ink` token (4.89:1 on `--paper`, 5.18:1 on `--paper-raise`)
  instead of the hot `--signal` (3.07:1 / 3.25:1). `theme.contrast.test.ts` now
  measures those two rules' resolved tokens as a property, so a future palette
  tweak below 4.5:1 fails with the measured ratio.
- **Sound heading outline on home/browse**: the product grid — owner of the
  single page `<h1>` — now precedes the rail `<h2>`s in DOM order, with a
  `.shop--browse` flex-`order` rule keeping the visual stack (rails above grid)
  unchanged. Guarded by a Storefront mount test on document positions.
- **The hybrid parity fixture generator replays `/search`'s real scoring**:
  `scripts/gen_hybrid_fixture.py` called the retrieval-less `rerank()` while the
  route (and the browser engine the fixture arbitrates) blend normalized RRF
  retrieval via `rerank_search()`. The weekly parity workflow's red on
  `hybrid_parity.json` was this script drift — the committed fixture was correct
  all along, and the fixed script regenerates it byte-for-byte. Pinned by a
  model-free regression test. `embedding_parity.json` refreshed with CI-exact
  bytes (float-only drift, ids/order intact, max delta 1.4e-07).

### Added
- **Measured release contract for the real browser path**: the C1 Chromium gate now
  boots the committed 720-product signed catalog with the real q8 MiniLM model,
  proves the Timberland waterproof boot is the first result for its exact query,
  rejects every request outside the app and signed-bundle origins, and enforces
  cold-start (30 s), warm-search (p50 300 ms / p95 750 ms), heap (512 MiB), and
  zero-backend-call budgets. The architecture and new security/privacy contract
  publish the same numbers, timeouts, retention bounds, data inventory, and
  residual risks.
- **Bounded API sessions**: the optional server now holds at most 10,000 session
  profiles, expires them after one hour idle, and evicts least-recently-used
  profiles deterministically under pressure.
- **Internationalization (i18next) across the app** (#36): `i18next` +
  `react-i18next` initialized in `src/i18n.ts` with bundled **offline** English
  catalogs (no runtime fetch), so user-facing copy resolves through `t()` and a
  locale can later be added as a pure copy-paste. Landing, Footer, Header,
  MetricsStrip, WhyPopover, BootScreen, and OfflineBadge copy moved into the
  `common` / `landing` / `storefront` / `errors` namespaces; numeric facts still
  interpolate from `landing-figures.ts`. `locales.parity.test.ts` auto-enforces
  exact key parity for any future locale, and a headless-Chromium
  `scripts/verify-i18n.mjs` gate asserts the Landing renders translated copy with
  a clean console in CI.
- **Canonical errors: vendored `@edgeproc/errors` + bundle-sync classification**
  (#37): the portfolio canonical-errors standard adopted at
  `frontend/packages/edgeproc-errors/` (zero runtime deps, TS source consumed
  directly), with a new `app/src/api/syncErrors.ts` seam whose
  `bundleErrorRegistry` classifies the demo's one user-facing failure — the
  signed catalog-bundle sync — into stable canonical codes
  (`bundle.download_failed`, `bundle.integrity_failed`, `bundle.timeout`,
  `bundle.device_unsupported`, `net.unreachable`, `internal.unknown`) keyed on
  the engine's typed error names. Behaviour-identical: the same raw failure still
  renders the same message and the same `errors.*` i18n string.

### Security
- **Zero third-party storefront egress by default**: remote catalog-image URLs now
  render as local editorial category tiles, the app uses platform-native fonts,
  and CSP/service-worker configuration no longer permits or caches Google Fonts,
  Amazon image hosts, Hugging Face, or jsDelivr. Release-owned root-relative
  product images remain supported.
- **Collector Docker context narrowed to `backend/`**: the optional image resolves
  release-tagged dependencies from `uv.lock`; sibling repositories, `.env` files,
  signing keys, PEM files, VCS state, and host caches never enter the build context.
- **Additive HTTP security headers + CI least-privilege permissions** (#32):
  a `/*` block of non-resource-restricting headers (`X-Content-Type-Options:
  nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: SAMEORIGIN` + `Content-Security-Policy: frame-ancestors
  'self'`, `Cross-Origin-Opener-Policy: same-origin`, a deny-by-default
  `Permissions-Policy`) that cannot break the same-origin ONNX/WASM/worker
  pipeline, and top-level `permissions: contents: read` on the CI and
  security-audit workflows (deploy already had it).
- **CodeQL URL and randomness alerts resolved** (#33): the product-image host
  check now matches `media-amazon.com` exactly or as a proper subdomain
  (was a spoofable `endsWith` substring test), and the session-id fallback
  uses `crypto.getRandomValues` instead of `Math.random` — telemetry disables
  itself rather than minting a weak id when Web Crypto is unavailable.
- **The in-browser embedder now fails closed on a missing local model
  weight**: `env.allowRemoteModels = false` (transformers.js defaults it to
  true), so a missing/renamed file under the self-hosted `/models/` mirror
  throws instead of silently falling back to an unpinned model on the
  Hugging Face CDN. Belt-and-suspenders on top of the cold-CDN-blocked e2e;
  the Node parity path (test-time HF fetch) is untouched.

### Changed
- **`edgeproc-core` now installs from PyPI** (`>=0.2.1`, locked to the registry
  release): the retired `shared-libs-python` git pin is gone from
  `[tool.uv.sources]` and `uv.lock` (zero git refs for it remain), and the
  `edge-proc` pin moved to `d88af07` (same v0.1.5 line, src-identical), the
  first rev whose own sources consume edgeproc-core from PyPI. Docs, SEO pages,
  and type-checker paths updated for the repo rename
  (`shared-libs-python` → `edgeproc-core`).
- **`@edgeproc/browser` public surface trimmed** (0.5.0): `EMBEDDING_MODEL` and
  `DEFAULT_RANKING_CONFIG` are engine-internal again — the model id is wired
  inside `createEmbedder` and the runtime reads ranking config from the signed
  bundle; no consumer imported either. `EMBEDDING_DIM` and the config *types*
  remain exported.
- **Search reranking preserves query relevance**: the normalized BM25/vector RRF
  signal contributes a measured 0.20 relevance component before session-aware
  product signals. Cross-tier parity and a real-model regression prevent a popular
  personalized apparel item from outranking the exact waterproof hiking boot.
- **Deployment success now means production identity**: missing Cloudflare secrets
  fail visibly; Wrangler records the exact CI SHA; the workflow waits for a
  successful Cloudflare production deployment with that SHA and rejects a missing
  or lossy `www` → apex permanent redirect. `public.key`, signed bundle bytes,
  Vite assets, model weights, and ORT files receive explicit MIME/cache contracts.
- **Production SEO, crawlability, and static delivery hardened** (#34): more
  crawlable root HTML with tighter search snippets, route-specific Open
  Graph/Twitter metadata for `/edgeproc`, `/github`, and `/faq`, sitemap
  `lastmod` values, a real noindex `404.html` replacing the SPA catch-all for
  unknown routes, HSTS + a resource-aware CSP with hashed JSON-LD, wildcard
  CORS removed from same-origin static responses, and built-artifact
  regression tests (`scripts/production-artifacts.test.mjs`) wired into the
  frontend gate. Recommendation and search logic unchanged.

## [0.11.0] — 2026-07-12

### Fixed
- **Deploy entrypoint invoked a nonexistent `edgereco sync` command**, so the
  demo container crashed on boot. The entrypoint now boots `edgereco serve` in
  signed-bundle mode (`EDGERECO_BUNDLE_BASE_URL` + `EDGERECO_VERIFY_KEY_PATH`,
  baked into the image with the demo catalog's committed public verify key) —
  `serve` self-syncs the content-addressed bundle fail-closed at startup. A new
  deploy smoke test (`backend/tests/integration/test_deploy_entrypoint.py`)
  executes every `edgereco <subcommand>` the entrypoint invokes against the
  real CLI and rejects dead env knobs / missing COPY sources, so the deploy
  scripts can no longer rot against the CLI.
- **A crashed embedding Web Worker hung every in-flight request to the timeout
  deadline** instead of failing fast. The engine client now rejects all pending
  requests with a typed `WorkerCrashError` the moment the worker fires `error`
  or `messageerror` (a reply that fails structured-clone), and latches so
  requests issued after the crash reject immediately.
- **The main-thread embedder client ignored `messageerror`**, so an embedder
  reply that failed structured-clone deserialization left the embed hanging to
  the deadline. It now wires `messageerror` for parity with the engine client
  and rejects the pending embed fast.
- **The browser query encoder was not bound to the catalog's declared embedding
  model**, and stale materialized index files could survive a rebuild.
  Publishing now binds the query encoder to the declared model and prunes stale
  materialized files, so query- and document-time vectors can never drift apart.
- **A stale search could overwrite newer results (latest-wins race).** A slow
  older query that resolved after a newer one repainted the grid with outdated
  results; the grid loader now guards every state write behind a monotonic
  request id, so only the latest query paints (and owns the loading flag).
- **One corrupt OPFS chunk poisoned every subsequent load forever.** A chunk
  that failed its content-address check on read left `hasChunk` true, so the
  sync loop never re-fetched it. The store now evicts the bad object on an
  `IntegrityError` (the read still fails closed) so the next sync self-heals by
  re-fetching it. Cache names, storage keys, and the OPFS bundle format are
  untouched — eviction operates on the content-addressed chunk object.
- **`publish` followed symlinks under the staging directory**, which would
  inline an arbitrary host file into the *signed* bundle (arbitrary-file read).
  It now refuses a symlinked staging entry before `is_file()` follows it and
  fails closed.

### Changed
- **Substrate legos bumped in dependency order (house standard §7):**
  `edge-proc` v0.1.1 → **v0.1.2** and `shared-libs-python` v0.1.2 → **v0.1.3**
  (edge-proc v0.1.2's metadata re-pins shared-libs v0.1.3, so both move
  together — a single-tag bump fails closed on conflicting git URLs). Lock
  lines verified moved; both upstream releases are gate/CI/docs-only.
- **`shared-libs-python` declared as a direct `[project.dependencies]` entry**:
  `edgereco.embeddings.index` imports `shared_libs_python.vector_mgmt` directly,
  so the manifest now states the dependency honestly instead of relying on it
  transitively via edge-proc (the `[tool.uv.sources]` entry already existed).

### Added
- **SEO entity hub**: GitHub links in the header ("Open source") and the site
  footer (now rendered on every view, Landing included), entity-page
  cross-links (`/edgeproc`, `/faq`, `/github` each carry a `footer.entity-nav`),
  and the homepage JSON-LD upgraded to an `@graph`
  (SoftwareApplication + SoftwareSourceCode + Person with `sameAs` → GitHub).
- **Cold-CDN-blocked e2e proof** (`tests/e2e-offline/cold-blocked.spec.ts`):
  the minified production build boots, loads the real model, and serves a real
  search with every HuggingFace host AND jsDelivr aborted — plus a provenance
  assertion that every cached model URL is same-origin.
- **One canonical gate per stack** (house standard §3): frontend root
  `pnpm gate` (= `gate:quality` + `gate:e2e`) and a dual-stack root
  `make gate`; CI jobs now run these exact commands instead of hand-copied
  step lists.
- **gitleaks CI job** (full-history, `fetch-depth: 0`) and a **`pnpm audit`
  lane** in the weekly security-audit workflow.

### Changed
- **The in-browser embedder makes zero runtime CDN fetches (house standard
  §8.1b).** The `all-MiniLM-L6-v2` weights are self-hosted under `/models/`
  (mirrored at build time by `scripts/download-model.mjs` — sha256-pinned,
  idempotent, fail-loud) with an explicit `dtype: "q8"` pin, and the
  onnxruntime-web wasm runtime is self-hosted under `/ort/`
  (`scripts/stage-ort-wasm.mjs`, staged from the lockfile-pinned node_modules
  copy). The new cold-blocked e2e caught the runtime dynamically importing its
  wasm loader from jsDelivr — a previously invisible CDN dependency; offline
  only worked because the service worker had runtime-cached it. Every mirrored
  file sits under Cloudflare Pages' 25 MiB single-asset limit, pinned by
  preflight tests. Existing clients upgrade cleanly: cache names, storage keys,
  and the OPFS bundle format are untouched (the old HF/jsDelivr runtime-cache
  routes remain as legacy fallbacks).
- transformers.js now owns the model's offline copy in its `transformers-cache`
  (was: SW CacheFirst over the HuggingFace host), with the Vite build target
  raised to `es2022` (the private-field downlevel crash guard).
- Backend complexity gate tightened to **xenon A/A/A** — the seven rank-B
  blocks (CLI `search`/`preprocess`, reco signals/audit/recommend candidates,
  API search route) were refactored to rank A with behavior-preserving helper
  extractions; 290 tests green at 99.75% coverage.
- `poe audit` switched to the portable §4 invocation (`uv export --frozen` →
  `pip-audit -r … --disable-pip --no-deps`): the audit now covers exactly what
  the lock pins, not whatever happens to be installed.
- CI e2e job's HuggingFace runtime-download cache replaced by a fixed-key
  cache of the self-hosted weights, shared by the frontend, e2e, and deploy
  jobs; the C1 embed suite dropped from minutes to seconds.
- `astral-sh/setup-uv` full-pinned to v8.3.2 in both workflows.

## [0.10.1] — 2026-06-27

A quality, security, and hardening release. No functional product changes — the signed
catalog bundle is byte-identical to 0.10.0 — but the code-quality bar is now *enforced*
rather than aspirational, a CVE is fixed at the root instead of suppressed, and several
fail-closed / robustness gaps are closed.

### Security
- **Dropped the torch CVE-2025-3000 suppression in favor of the real fix.** Pinned
  `torch >= 2.12.1` (the version that fixes the CVE) and removed `pip-audit
  --ignore-vuln`; the dependency audit is now genuinely clean, with zero suppressions.

### Changed
- **The no-explicit-`Any` ban is now enforced**, not just documented. Added ruff
  `ANN401` (repo-wide) + mypy `disallow_any_explicit`, plus an AST guard test that
  forbids `Any` in any annotation across `src` — closing the gap where a model-field
  `dict[str, Any]` could evade both tools. Eliminated every existing explicit `Any`:
  source annotations narrowed to precise `Mapping`/union types (annotation-only, so the
  bundle is unchanged), and the pytest-bdd context replaced with typed `StepContext`
  dataclasses.
- **`/events` hardening:** wire models reject unknown fields (`extra="forbid"`),
  `session_id` is length-bounded, the unknown-product warning is aggregated per request,
  the auth settings are resolved once instead of per request, and the fail-closed bundle
  loaders are promoted to public functions in `api/deps.py`.
- **Coverage is gated on both tiers.** Added `@vitest/coverage-v8` thresholds to both
  frontend workspaces and raised the Nimbus app's view-layer line coverage from ~62% to
  ~92% with real component tests; the offline-PWA Playwright proof now runs in CI.
- **README architecture diagram** now embeds a pre-rendered SVG
  (`docs/diagrams/architecture.svg`) with the Mermaid source preserved in a collapsible
  block, so it renders even where GitHub's `viewscreen` Mermaid iframe is blocked.

### Fixed
- **`/events` returns 401 (not 500) for a non-ASCII bearer token** — the comparison is
  byte-based and still rejects (no bypass).
- **The telemetry uplink can no longer throw into the click handler.** `localStorage`
  reads/writes are fully guarded, so a full/disabled store (quota, private mode) degrades
  to in-memory instead of escaping the fire-and-forget path.
- **The browser engine validates the whole product row** before use — numeric
  `popularity_score`/`price`/`freshness_score`, string `title`/`category`/`brand`, array
  `tags`, positive-integer index/count — and raises the typed `VectorIndexError` on every
  malformed-bundle path, so a malformed-but-signed bundle fails closed instead of
  silently corrupting ranking.
- **No duplicate cards in a rail** (dedupe by normalized title at the render layer,
  parity-safe) and **stable, unique rail heading ids** derived from the rail key.
- Repaired broken relative links in `edgeproc-browser/README.md` and
  `demo_server/README.md`; corrected a stale strategy-count code comment and removed a
  stale `docs/superpowers/` reference.

### Removed
- Four orphaned diagram SVGs and their `.d2` sources (including the stale pre-pivot
  `demo-architecture` diagram that contradicted the backend-free positioning).

## [0.10.0] — 2026-06-26

### Added
- **Installable, offline-capable PWA.** The Nimbus storefront is now an installable
  Progressive Web App that works **fully offline after one online sync**. A Workbox
  service worker precaches the app shell and the ~25 MB embedding model; the signed
  catalog bundle stays OPFS-owned, preserving the Ed25519 + SHA-256 fail-closed
  guarantees. Adds an in-app install affordance (install button + offline badge).
  Offline operation is proven by a real-browser Playwright e2e (`test:e2e:offline`):
  warm online, cut the network, reload — the store still mounts and ranks.
- **`SECURITY.md`** — private vulnerability-reporting policy plus the signed-bundle
  trust model (Ed25519 verify-before-trust, SHA-256 content-addressing, pinned key).
- A **"View source on GitHub"** link on the landing page.

### Changed
- **Open-source launch.** Relicensed from Apache-2.0 to **MIT** (LICENSE + all
  package manifests); `NOTICE` retained for third-party data attribution only.
- **Clone-and-go onboarding.** The backend pulls its substrate libs (`edge-proc`,
  `shared-libs-python`) from public GitHub via git sources pinned to release tags,
  so `git clone … && cd backend && uv sync` builds with no sibling checkout. CI
  dropped the private-sibling checkout + path-patch + `PORTFOLIO_PAT` secret and now
  builds exactly as an external cloner does. A commented path-source override remains
  for substrate co-development.
- **Plain-language docs.** README and the SPA landing lead with the value proposition
  in non-technical terms (zero per-query cloud cost, scales on the clients not the
  servers, resilient on weak/dropped connections), make explicit that companies — not
  shoppers — bear cloud search/reco cost, add a Mermaid architecture diagram, and
  cross-link the `edge-reco → edge-proc → shared-libs-python` stack as one system.
- **Docs tidy for the public repo.** Removed the pre-pivot `docs/archive/` and the
  internal `docs/superpowers/` planning docs from the published tree (preserved in
  project history); fixed the references that pointed at them; relabeled the
  `DEPLOY.md` compose snippet as abridged.

### Fixed
- **`audit` now fails closed.** The `edgereco audit` path threads the bundle schema
  version into the co-occurrence and ranking-config loaders, so a schema-mismatched or
  corrupt bundle is rejected instead of silently degrading to an empty matrix / default
  weights — matching the serving path.
- **Demo `/events` collector hardened.** Request batches are capped
  (`max_length=1000`, oversized → 422) and an optional fail-closed bearer token
  (`EDGERECO_EVENTS_TOKEN`) guards `/events` and `/events/export` (unset = open, so the
  local flywheel demo keeps working tokenless).
- **Uplink no longer double-sends or drops events on tab unload.** The in-flight batch
  is claimed before the network call, so a concurrent `flushBeacon()` only beacons the
  un-sent tail (restoring order on failure). Still fire-and-forget, off the inference path.
- **Browser engine validates bundle data fail-closed.** `products.jsonl`,
  `catalog_meta.json`, and the vector state are now runtime-validated (rejecting
  malformed data) instead of unchecked casts; live performance entries degrade-and-skip
  rather than throwing.
- Internal: the scorer's reputation penalty was rewritten to an explicit
  single-subtraction form (behavior-preserving; Python↔TS scoring stays byte-identical).

## [0.9.0] — 2026-06-11

### Added
- **Richer interaction signals** — the storefront now emits the full graded
  vocabulary the engine and retrain already understood: a favorite heart
  (once per product per session; unfavoriting is visual-only), add-to-cart
  (every press; header cart pill; first add carries a "nothing is purchased"
  honesty note), and capped ambient dwell views (≥75% visible for 2 s, once
  per product, silent). Cart-over-clicks facet dominance is pinned against
  the real engine fold in `signals/gradedSignals.test.ts`; a single cart-add
  visibly re-ranks the rail in e2e. Zero engine/backend/weight change;
  parity fixtures byte-identical.

### Changed
- The rail badge counts all explicit signals (clicks + favorites + cart-adds)
  app-side; product cards are now `<article>` roots with a full-card
  "add to taste" overlay button plus layered signal buttons (keyboard
  focus-visible styles included), and the image hover-zoom is driven from
  card-level CSS.

## [0.8.0] — 2026-06-08

### Added
- **Intro landing + live metrics** — the SPA now opens on a landing page that
  explains what EdgeReco is and why running discovery in the browser is effective,
  then a **"Launch the live demo"** button boots the engine. Inside the store, a
  live `MetricsStrip` shows REAL in-browser measurements: recommendation latency,
  backend calls after sync (0), cold start, JS-heap memory, and catalog size.
  Honesty is enforced and tested — memory is labelled "JS heap (Chromium)" and
  hidden when unavailable (never faked); the "0 backend calls" counter excludes
  product images and the optional uplink; the cost figure is labelled
  "illustrative". New `src/metrics/*` (store + classifier + observers),
  `Landing` / `MetricsStrip` components, and instrumentation in `api/client.ts`,
  `App.tsx`, and `Storefront.tsx`. Design captured in an internal design spec
  (since archived).

### Changed
- **Demo allocates random free ports per run** — `make demo` / `poe demo` /
  `poe demo-flywheel` no longer pin :8081 / :5174 / :8000. A single orchestrator
  (`frontend/app/scripts/demo.mjs`) picks free ports and wires them through the
  compose port-mappings, Vite, the collector CORS allow-list, and the edge
  preflight, removing cross-project and stale-container port collisions. Standalone
  `docker compose up` still defaults to 8081/8000/5174. The poe tasks,
  `backend/pyproject.toml`, and the Makefile are now thin wrappers over the one
  orchestrator.
- Demo SPA dev port moved to **5174** (was 5173), pinned via Vite `strictPort` so it
  fails loudly rather than silently landing elsewhere. The collector CORS allow-list,
  Docker port mapping, Playwright e2e, and docs were updated to match.

## [0.7.0] — 2026-06-05

### Added
- **Flywheel retrain (the loop closes)** — the cloud half that v0.6.0's uplink set
  up: aggregate the collected interaction events → recompute `popularity_score` →
  rebuild, **re-sign, and republish** the content-addressed bundle (new `latest`).
  Both tiers (Python core + `@edgeproc/browser`) pick up the new popularity on
  their next sync — **with zero scoring-formula changes**, because the scorer is
  coefficient-driven and reads `popularity_score` straight off the synced product.
  The prebuilt FAISS `vector/` is reused verbatim (embeddings depend on product
  text, not popularity), so a retrain re-encodes nothing.
  - New `GET /events/export` aggregates the collector's event buffer into weighted
    engagement per product (the retrain read seam).
  - New `edgereco retrain` CLI: sync the current bundle → fold in engagement →
    republish a freshly signed bundle (`backend/src/edgereco/republish.py` +
    `reco/retrain.py`). Engagement is an additive, max-normalized boost
    (`new_pop = clamp01(base_pop + α · engagement_norm)`, `α` tunable).
  - New `poe demo-retrain`: after clicking around under `poe demo-flywheel`,
    recompute + republish into a **runtime origin** (the demo edge serves a
    writable copy seeded from the committed bundle, so the committed seed stays
    byte-stable). Refresh the SPA — the edge revalidates `latest` within 30s and
    the rail re-ranks toward what was clicked. Requires the maintainer signing key
    (`examples/keys/private.key`, gitignored) since the bundle is re-signed.

## [0.6.0] — 2026-06-05

### Added
- **Flywheel uplink (the "events back to the cloud" loop)** — clicks are now
  captured in-tab, persisted (localStorage), and periodically flushed in batches
  to a "mimicked cloud" collector (the existing FastAPI `/events`). It is an
  **optional, async, fire-and-forget beacon kept entirely off the inference
  path** and **off by default**: with `VITE_EVENTS_URL` unset the demo makes zero
  backend calls (the headline invariant holds). New `poe demo-flywheel` brings up
  the collector container and runs the SPA with the uplink enabled; a `SyncBadge`
  shows "N interactions synced to cloud". Implemented in
  `frontend/app/src/telemetry/uplink.ts` (bounded queue, `fetch(keepalive)` +
  `navigator.sendBeacon` on unload), wired into `sendEvent` without touching the
  in-tab rerank. The collector's `/events` gained an optional in-body `session_id`
  so beacon batches (which can't set headers) attribute correctly.
  _Retrain half (aggregate events → recompute popularity → republish the signed
  bundle) is intentionally future work._

## [0.5.1] — 2026-06-03

Make the turnkey `poe demo` robust against a cross-project Docker collision that
surfaced as a cryptic **"signature verification failed"** in the browser. The
engine, signed bundle, pinned key, and fail-closed verify were all correct — the
failure was purely in demo orchestration when another project occupied `:8081`.

### Fixed
- **Isolated the demo's Docker namespace** — `frontend/docker-compose.yml` now pins
  `name: nimbus-demo`, so its volumes/network are `nimbus-demo_*` instead of the
  directory-derived default `frontend`. A sibling repo with its own `frontend/`
  compose dir no longer shares (and contaminates) the same `caddy_data` volume.
  This was the root cause: a foreign-but-valid signed `/latest` answered on `:8081`
  and failed the SPA's pinned-key verify.
- **`poe demo` now fails clearly, early** — the task runs `docker compose up -d
  --wait` (no startup race) and a preflight (`frontend/app/scripts/check-edge.mjs`)
  that asserts `:8081/latest` matches this repo's committed bundle pointer before
  opening the SPA. If another project occupies `:8081`, the user gets an actionable
  terminal message instead of a browser crypto error.

### Added
- **Preflight regression test** — `frontend/app/scripts/check-edge.test.mjs`
  (`pnpm test:preflight`, zero-dep `node:test`) covers the match / foreign-bundle /
  unreachable / non-200 / malformed-pointer branches; wired into CI.

## [0.5.0] — 2026-06-01

The session-aware reranker now *shows*: clicking products visibly re-ranks the
"Recommended for you" rail, backed by a balanced multi-category demo catalog.

### Added
- **Streaming demo-catalog curator** — `backend/scripts/curate_demo_catalog.py`
  builds a balanced, reproducible catalog source (`backend/examples/source/catalog.csv`)
  by streaming a real Amazon metadata parquet (memory-bounded; never loads the
  source's embeddings column). Pass `--source <parquet>`.

### Changed
- **Affinity-first recommendation rail** — clicking products now *visibly* re-ranks
  "Recommended for you". `recommend()` selects its candidate pool by session affinity
  when warm (popularity backfills only when there are fewer than `limit` matches);
  cold start stays popularity top-N. The scoring formula is unchanged — only candidate
  *selection* changed. Implemented byte-parity in the Python core (`reco/pool.py`) and
  the in-browser engine (`poolSelection.ts`).
- **Demo catalog rebuilt to 720 products across 12 balanced categories** (60 each), so
  session-aware reranking has real signal to act on (the previous bundle was ~98% one
  category). The committed signed bundle is re-signed with the existing pinned key, so
  fail-closed verification is unaffected.

### Fixed
- The "Recommended for you" rail no longer appears frozen on click — a data + candidate-
  pool problem, not a wiring bug (the click → profile → rerank loop was always correct).

### Docs
- Re-attributed the demo catalog to the **Amazon Reviews 2023** dataset (McAuley Lab,
  UC San Diego) in `NOTICE` and the README, with the underlying-content rights caveat.

## [0.4.1] — 2026-05-31

Developer-experience polish: a one-command, browser-opening demo runner.

### Added
- **Turnkey `poe demo` task** — `cd backend && uv run poe demo` brings up the
  signed-bundle Caddy edge (`:8081`), starts the Vite SPA (`:5173`), and opens the
  storefront in your browser: one command from clone to running in-tab. Surfaced in
  the README "Try it" section, `docs/ARCHITECTURE.md`, and `docs/QUICKSTART.md`.

## [0.4.0] — 2026-05-30

Public-launch readiness: legal attribution for the demo dataset, a clear
fictional-product disclaimer, a two-altitude README, and a reusable sync-tier
export — so a cold visitor sees an honest, runnable, properly-credited demo.

### Added
- **`@edgeproc/browser/engine`** — new stable public subpath export promoting the
  domain-agnostic sync tier (`EngineClient`, OPFS/memory CAS stores, the
  `syncIndex` state machine, crypto + wire types) to a first-class API. Previously
  reachable only behind the `./testing` seam marked "NOT production surface"; now
  a reusable sync tier for downstream consumers of the edgeproc pattern. Purely
  additive — the `.` (search) and `./testing` surfaces are untouched.
- **`NOTICE`** crediting the demo catalog's source: the Kaggle "Amazon
  E-commerce Products & Reviews Dataset" (MIT), with an Amazon Terms-of-Service
  caveat for the underlying product data.
- **Fictional-demo footer** in the storefront UI making explicit that "Nimbus"
  is a fictional store and the catalog is third-party sample data — plus
  browser/backend parity and config comments clarifying the shared search knobs.

### Changed
- **Two-altitude README**: a plain-language front door (what it is, how to run
  it) above an "under the hood" section for engineers, heroing the in-browser
  personalization story and surfacing the `edge-proc` dependency.
- **Offline-resilient `syncIndex`**: when the signed index can't be fetched, the
  browser tier now falls back to the cached active version instead of failing.

### Fixed
- **License consistency**: project unified on **Apache-2.0** (the README badge
  previously contradicted the declared license); data attribution corrected.
- npm→pnpm drift in the docs; e2e storefront screenshots redirected to a
  gitignored `test-results/` path.

## [0.3.0] — 2026-05-29

Hardening: full test pyramid wired into CI, modern dependencies, and a
discoverable config surface — so the repo is not just clear but provably works
end-to-end on a cold clone.

### Added
- **Playwright e2e in CI** (`.github/workflows/frontend.yml`): the storefront
  suite and the C1 sync suite now run on every push/PR, with HuggingFace model
  weights cached and traces uploaded on failure.
- **In-browser model-load smoke test** (`frontend/app/tests/e2e-c1/embed.spec.ts`
  + `embed-harness.html`): loads the real MiniLM model through onnxruntime-web
  WASM in headless Chromium and asserts a normalized 384-d embedding — guarding
  the browser ML path that unit tests (Node backend) can't cover.
- **`.env.example`** for both `backend/` and `frontend/`, documenting every env
  var the code reads, referenced from a new README "Configuration" section.
- Typed Pydantic response models for the API routes (`backend/.../api/models.py`).
- Backend `poe gate` task mirroring CI (lint + format-check + mypy + pytest-cov).

### Changed
- **Dependencies modernized.** Backend: mypy 1.20→2.1, polars 1.41,
  pydantic 2.13.4, sentence-transformers 5.5, typer 0.26, uvicorn 0.48, plus
  raised constraint floors. Frontend: transformers.js 3.8→4.2 (onnxruntime-web
  1.26-dev), jsdom 26→29; pinned Node via `engines` + `.nvmrc`.
- `@edgeproc/browser/testing` is now browser-safe; the node-only fixture loader
  moved behind `@edgeproc/browser/testing/fixtures` so importing the test-seam
  barrel never drags `node:fs` into a browser bundle.

### Fixed
- **Both Playwright suites were silently broken** since the `backend/`+`frontend/`
  restructure: `catalog-server.mjs` still resolved the signed catalog at the
  pre-restructure repo-root `examples/` instead of `backend/examples/`.
- Removed `@rolldown/binding-darwin-arm64` from direct deps (it is an optional
  per-platform binding) — `npm ci` on the Linux CI runner no longer fails.

## [0.2.0] — 2026-05-28

The Nimbus demo goes **backend-free**: the SPA syncs the signed bundle and runs
the full hybrid-search + session-aware-rerank pipeline in the browser tab. No
application backend in the request path. The in-browser engine is extracted as
a reusable workspace package, and the demo gains its own frontend CI.

### Added
- `@edgeproc/browser` — new private npm workspace package
  (`frontend/packages/edgeproc-browser/`). In-browser signed-bundle sync into OPFS
  (ed25519 + sha256 fail-closed), reassembly, and the full hybrid-search engine
  (BM25 ⊕ vector → RRF → session rerank). Top-k parity-tested against the
  Python core over the same committed bundle.
- Browser embedder via transformers.js (`Xenova/all-MiniLM-L6-v2`,
  `{ pooling: "mean", normalize: true }`) — the byte-for-byte equivalent of the
  Python core's query encoder.
- Backend-free `docker compose up --build` path: `origin` → Caddy `edge` → static
  Nimbus SPA. No FastAPI in the request path; the browser does the search.
- Real 728-product Amazon catalog committed as the demo bundle
  (`examples/catalog/`), built via `edgereco build-catalog` → `index` → `bundle`.
- Frontend CI workflow: Biome lint + tsc + Vitest across the npm workspace plus
  Playwright end-to-end coverage of the backend-free hero loop (sync → search →
  click → rail re-rank → "why?" panel).

### Changed
- Top-level README + `CLAUDE.md` rewritten to make the backend-free demo the
  headline path; the Python FastAPI runtime is reframed as the optional
  server-side API variant.
- `@edgeproc/browser` public surface trimmed: low-level sync primitives
  (`MemoryCacheStore`, `syncIndex`, `materializeFile`, `Verify` / `FetchBytes`
  / `CacheStore`) moved behind the `./testing` subpath; the main entrypoint is
  the production runtime (`EngineRuntime`, `SearchEngine`, the domain types).
- Demo data layer (`frontend/app/src/api/client.ts`) refactored from
  module-level mutable state to a `createDataClient(runtime)` factory.

## [0.1.0] — 2026-04-30

First public release. Python v1 reference architecture for edge-first product discovery.

### Added
- Manifest-based catalog sync with sha256 checksums
- BM25 keyword index (`rank-bm25`) and FAISS vector index (`sentence-transformers/all-MiniLM-L6-v2`), built via `edgereco index`
- Reciprocal Rank Fusion hybrid search (`edgereco search`, `GET /search`)
- Session-aware reranker: `0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`
- Interaction event ingest (`POST /events`) with click / view / favorite / cart weights
- Recommendation endpoint with session signals (`GET /recommend`)
- Typer CLI: `index`, `serve`, `search`, `preprocess`
- FastAPI app with Protocol-based DI for edge clients (HTTP + filesystem adapters)
- Synthetic 1000-product demo catalog (superseded in 0.2.0 by the committed 728-product Amazon bundle built via `edgereco build-catalog`)
- Docker Compose stack: origin + Caddy edge + app, with healthcheck-gated startup
- BDD test suite (5 Gherkin features), integration + e2e coverage, 98%+ line coverage
- GitHub Actions CI: ruff + mypy strict + pytest with 90% coverage gate
