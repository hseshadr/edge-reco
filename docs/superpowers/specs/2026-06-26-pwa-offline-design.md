# EdgeReco PWA / offline-install — design

**Status:** approved design, ready for plan
**Date:** 2026-06-26
**Scope:** the Nimbus storefront (`frontend/app/`) + a one-line change in `@edgeproc/browser`

## TL;DR

Make the Nimbus storefront an installable PWA that works **fully offline after one online sync**.
The signed catalog bundle already persists in OPFS and is reused across reloads; the gap is the
**app shell** (no service worker → white-screen risk offline) and the **embedding model** (fetched
from the HuggingFace CDN, cached only by transformers.js's own undocumented behavior). We add a
Workbox service worker (via `vite-plugin-pwa`) that precaches the app shell and explicitly owns
offline caching of the model + fonts, plus a web manifest and icons so the store installs to a home
screen. The headline proof is a Playwright test that warms the app online, cuts the network, reloads,
and asserts a search returns ranked results offline.

## Goal & non-goals

**Goal.** After a single online sync, with the network cut, the storefront:

- loads with no white screen (service worker serves the app shell),
- runs **hybrid search** — both lexical (BM25) and vector (query embeddings computed on-device),
- renders browse + recommendation rails,
- renders fonts,
- is **installable** and launches standalone from the home screen.

**Explicit non-goals (named, not built):**

- Self-hosting the embedding model to remove the HuggingFace runtime dependency (a future task; see
  "Model caching" — we chose the SW-owns-it option, which keeps the model first-fetched from HF).
- Progressive origin→device handoff.
- Background refresh of the catalog bundle (bundle updates already flow through OPFS sync).
- Caching external product images (impossible to precache; see "Honest degradation").

## Offline contract

After one online sync, network off:

| Capability | Offline behavior |
|---|---|
| App shell loads | ✅ served by the service worker precache |
| Lexical search (BM25) | ✅ runs from the OPFS bundle |
| Vector search (query embeddings) | ✅ model served from the SW cache, inference in the embedder Worker |
| Browse + recommendation rails | ✅ from the OPFS bundle + co-occurrence map |
| Fonts | ✅ runtime-cached (Google Fonts) |
| Install / standalone launch | ✅ manifest + icons |
| Product images | ◻︎ fall back to the existing placeholder tiles (external hosts can't be cached) |
| `latest` bundle pointer | ◻︎ not cached by the SW; offline sync degrades to the OPFS `active` version (existing behavior) |

## Architecture

### Tooling

`vite-plugin-pwa` in **`generateSW`** mode (declarative Workbox config — no hand-written service
worker). Rationale: industry-standard for Vite, integrates with Vite 8, injects the manifest link and
registration, and resolves `start_url`/`scope`/precache paths against `import.meta.env.BASE_URL` so the
same build is correct on both the apex deploy (`VITE_BASE=/`, Cloudflare Pages) and the GitHub-Pages
fork deploy (`VITE_BASE=/edge-reco/`).

### Caching strategy

**Precache** (Workbox `globPatterns`): the Vite build output — `index.html`, hashed JS/CSS, **both
worker scripts** (`worker.ts`, `embedderWorker.ts` emitted assets), icons. **`globIgnores` excludes
`bundle/**`** — the signed catalog is large, mutable (`latest`), and already owned by OPFS. If the
build emits the ONNX/zstd WASM as same-origin assets, they are precached automatically; if they resolve
to a CDN at runtime, they get a runtime-cache route (confirm during implementation — see Risks).

**Runtime caching routes** (`runtimeCaching`):

1. **Google Fonts stylesheets** (`fonts.googleapis.com`) — `StaleWhileRevalidate`.
2. **Google Fonts files** (`fonts.gstatic.com`) — `CacheFirst`, 1-year expiration.
3. **Embedding model — the SW owns it.** A `CacheFirst` route matching the HuggingFace host(s) the
   embedder actually fetches (`https://huggingface.co/Xenova/all-MiniLM-L6-v2/...` and any LFS-redirect
   CDN host it lands on), with a generous `maxEntries`, `cacheableResponse: { statuses: [0, 200] }`, and
   `RangeRequestsPlugin` if transformers.js issues range requests. To make the SW the **single** cache
   owner (no double storage), set transformers.js `env.useBrowserCache = false` (see file changes).

**Never cached:** `dist/bundle/**`, the mutable `latest` pointer, external product images.

### Update strategy

`registerType: 'autoUpdate'`. The app shell changes rarely, and bundle updates flow through OPFS sync
independently of the service worker, so a reload-prompt toast would be noise. (Reversible: switch to
`prompt` + a reload toast if we later want explicit update control.)

## Components & file changes

### New / generated assets (`frontend/app/public/`)

- `pwa-192.png`, `pwa-512.png`, `pwa-maskable-512.png` — generated from the existing `favicon.svg`
  cloud mark.
- `_headers` — Cloudflare Pages header rules so `sw.js` and the manifest are served `no-cache` (SW
  updates propagate immediately); hashed assets keep long-cache defaults.

### `frontend/app/vite.config.ts`

Add the `VitePWA({...})` plugin: `registerType: 'autoUpdate'`, `manifest` block (name "Nimbus", short
name "Nimbus", description, `display: 'standalone'`, theme/background colors from the brand palette,
the three icons, base-relative `scope`/`start_url`), `workbox: { globPatterns, globIgnores: ['**/bundle/**'],
runtimeCaching: [...] }`. The plugin injects the manifest `<link>` and a `theme-color` meta.

### `frontend/app/src/` (registration + UX)

- **SW registration** via the plugin's `virtual:pwa-register` (or `virtual:pwa-register/react`), wired
  once near the app entry (`main.tsx` / a small `usePwa` hook). Must be a no-op under test/jsdom.
- **`useInstallPrompt` hook + Install affordance** — capture `beforeinstallprompt`, expose
  `canInstall` + `promptInstall()`, render a small dismissible "Install" control in the storefront
  chrome. Hidden when already installed (`display-mode: standalone`) or unsupported.
- **`OfflineBadge` component** — subscribes to `online`/`offline` events; when offline shows a subtle
  *"Offline — running fully on your device"* pill. This is the product thesis surfaced as a positive,
  and it must tell the truth (only shown when actually offline).

### `frontend/packages/edgeproc-browser/src/engine/embedder.ts`

Set transformers.js `env.useBrowserCache = false` (import `env` from `@huggingface/transformers`) so
the **service worker is the single cache owner** for the model. One small, well-commented change next
to the existing `EMBEDDING_MODEL` constant. (If validation shows the SW can't reliably cache the HF
responses, the fallback is to re-enable this and keep the SW for the app shell only — see Risks.)

### Build / deploy

- `frontend/app/scripts/build-pages.mjs` — verify ordering: Vite (with the PWA plugin) generates
  `sw.js` + `manifest.webmanifest` into `dist/` **before** the `cpSync` that copies the bundle into
  `dist/bundle/`, and the precache glob ignores `bundle/**`. No logic change expected; add an assertion
  if cheap.
- Docker path (`serve -s dist`) serves `sw.js` same-origin automatically — no change.

## Testing strategy (TDD)

**Unit (Vitest/jsdom):**

- `useInstallPrompt` — fires on `beforeinstallprompt`, exposes `canInstall`, calls the saved event's
  `prompt()`, hides when standalone.
- `OfflineBadge` — renders only when offline; toggles on `online`/`offline` events.
- SW registration is guarded to a no-op in the test environment (assert it doesn't throw under jsdom).

**E2E (Playwright) — the headline proof (`tests/e2e/offline.spec.ts`):**

1. Load the app online (existing e2e harness: vite :5174 + catalog-server), launch, wait for `ready`.
   *Note:* the existing suite stubs the embedder to avoid the 25 MB download. The offline test needs a
   real (or pre-seeded) model cache to prove vector search — decide in the plan whether to (a) run this
   one spec against the real model, or (b) seed the SW cache with a small fixture. Default: real model,
   marked slow, with a generous timeout, gated so it can be skipped in constrained CI.
2. `context.setOffline(true)`.
3. Reload the page.
4. Assert: app shell renders (no white screen / error boundary), a search query returns ranked results,
   and the offline badge is visible.
5. Assert the manifest is linked and `sw.js` is registered (installability signal).

This E2E is the **validate-end-to-end** gate per project norms — it must be watched to pass, not assumed.

## Honest degradation (offline, uncached)

- **Product images** → existing placeholder tiles (`ProductImage.tsx` already handles broken/empty
  `image_url`). No false "image loading" state.
- **`latest` pointer unreachable** → OPFS sync falls back to the cached `active` version (existing,
  fail-closed behavior). The SW does not mask this.
- The offline badge only appears when the browser reports offline — no lying about connectivity.

## Risks & mitigations

1. **HF LFS redirect host (top risk).** Model weights live on Git-LFS and `resolve/main/...` URLs
   302-redirect to a CDN host. The SW `CacheFirst` route must match the URLs actually fetched. Mitigation:
   capture the network during a real warm-up, set the route pattern accordingly, and let the offline
   E2E be the gate. If Workbox can't reliably cache them (opaque/redirect/range issues), fall back to
   re-enabling transformers.js `env.useBrowserCache = true` (belt-and-suspenders) while the SW still
   covers the app shell + fonts.
2. **Worker-scoped fetches.** The model is fetched inside `embedderWorker.ts`. Same-origin dedicated
   workers are within the SW scope, so their fetches are interceptable — confirm in the E2E.
3. **Base path.** Every manifest/precache/scope URL must be base-relative (`BASE_URL`), validated on
   both `VITE_BASE=/` and `/edge-reco/` builds.
4. **Stale SW on the live host.** `public/_headers` must keep `sw.js`/manifest `no-cache` or Cloudflare
   may serve a stale worker.
5. **Bundle never precached.** `globIgnores: ['**/bundle/**']` is load-bearing — precaching the multi-MB
   mutable bundle would bloat installs and pin a stale `latest`.

## Plan decomposition (for writing-plans)

1. PWA scaffold — plugin, manifest, icons, registration (no-op under test).
2. Caching rules — precache globs + `globIgnores`, runtime routes (fonts + model), `embedder.ts` env change.
3. UX — `useInstallPrompt` + Install affordance, `OfflineBadge` (unit-tested first).
4. Deploy — `public/_headers`, `build-pages.mjs` ordering check.
5. Offline E2E — `tests/e2e/offline.spec.ts` (the proof), run for real.
