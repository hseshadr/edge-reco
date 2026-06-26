# EdgeReco PWA / Offline Storefront — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Nimbus storefront an installable PWA that works fully offline after one online sync.

**Architecture:** Add a Workbox service worker via `vite-plugin-pwa` (`generateSW` mode) that precaches the built app shell, runtime-caches Google Fonts, and **owns** the embedding-model cache (transformers.js browser cache disabled so there is a single owner). Add a web manifest + generated icons for installability. Mount a small Install affordance and an honest offline badge. Prove it with a Playwright test that warms the app online, cuts the network, reloads, and asserts the store still mounts and ranks.

**Tech Stack:** Vite 8, React 19, TypeScript, `vite-plugin-pwa` (Workbox), `@huggingface/transformers` (transformers.js), `sharp` (one-shot icon generation), Playwright, Vitest, node:test, pnpm.

## Global Constraints

- pnpm workspace; the app package filter is `pnpm -F frontend` (package name is `frontend`). Node `>=22.12`, `pnpm@11.5.0`.
- `vite-plugin-pwa` **must be a version that lists Vite 8 in its peer deps**. Install with `pnpm -F frontend add -D vite-plugin-pwa` and verify no peer-dep error against `vite ^8.0.16`; if it refuses, pick the latest release that supports Vite 8.
- **Base-relative everything.** The same `dist` deploys at `/` (apex, Cloudflare Pages) and `/edge-reco/` (GitHub Pages forks). Manifest `scope`/`start_url`, icon `src`, `navigateFallback`, and precache URLs must resolve through `import.meta.env.BASE_URL` — never hardcode `/`. The PWA plugin does this when given relative values; do not defeat it.
- **Never precache the signed bundle.** Workbox `globIgnores` must include `**/bundle/**`, and the build ordering (vite build → then copy bundle) must be preserved. The mutable `latest` pointer must never be cached by any route.
- Service worker registration lives only in `src/main.tsx` (never imported by unit tests), and the PWA Vite plugin is disabled under Vitest (`process.env.VITEST`) so unit tests are unaffected.
- Add `tests/e2e-offline/**` to the Vitest `exclude` list (Playwright owns it, same as `tests/e2e/**`).
- Copy is plain-language (Karpathy clarity). Offline badge text: `Offline — running fully on your device`.
- Brand tokens (from `src/index.css`): `--paper #faf6ef` (background), `--signal #ff4d2e` (accent), `--ink #17120e`, `--abyss #1c3a4a`, `--line #e5ddd0`. Manifest: `background_color: "#faf6ef"`, `theme_color: "#ff4d2e"`.
- **Commit trailer:** end every commit with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` and **no** `Claude-Session:` line (public-repo privacy rule).
- Run on branch `pwa-offline` (already created). Quality gates per task: `pnpm -F frontend lint` (Biome), `pnpm -F frontend typecheck` (tsc), `pnpm -F frontend test` (Vitest) must stay green.

**Task dependency order:** 1 → 2; 3, 4, 5 independent (can run in parallel); 6 depends on 4 + 5; 7 depends on 1–6.

---

### Task 1: Generate PWA icons from the brand mark

**Files:**
- Create: `frontend/app/scripts/gen-icons.mjs`
- Create (generated, committed): `frontend/app/public/pwa-192x192.png`, `frontend/app/public/pwa-512x512.png`, `frontend/app/public/maskable-512x512.png`
- Test: `frontend/app/scripts/pwa-icons.test.mjs`
- Modify: `frontend/app/package.json` (add `sharp` devDep + `gen-icons` script)

**Interfaces:**
- Produces: three committed PNG icon files at the paths above (192×192, 512×512, 512×512-maskable). Consumed by the manifest in Task 2.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/scripts/pwa-icons.test.mjs`:

```js
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");

/** Parse width/height from a PNG's IHDR chunk (no image lib needed). */
function pngSize(file) {
  const b = readFileSync(file);
  assert.equal(b.toString("ascii", 12, 16), "IHDR", `${file} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test("PWA icons exist at the declared sizes", () => {
  for (const [name, size] of [
    ["pwa-192x192.png", 192],
    ["pwa-512x512.png", 512],
    ["maskable-512x512.png", 512],
  ]) {
    const p = join(PUBLIC, name);
    assert.ok(existsSync(p), `${name} missing — run \`pnpm -F frontend gen-icons\``);
    const { w, h } = pngSize(p);
    assert.equal(w, size, `${name} width`);
    assert.equal(h, size, `${name} height`);
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F frontend test:preflight`
Expected: FAIL — `pwa-192x192.png missing — run pnpm -F frontend gen-icons`.

- [ ] **Step 3: Add `sharp` and the `gen-icons` script to package.json**

In `frontend/app/package.json`, add to `scripts`: `"gen-icons": "node scripts/gen-icons.mjs"`. Then:

Run: `pnpm -F frontend add -D sharp`
Expected: sharp installed (pnpm fetches its prebuilt binary).

- [ ] **Step 4: Write the icon generator**

Create `frontend/app/scripts/gen-icons.mjs`:

```js
// One-shot PWA icon generation from the brand favicon. Outputs are COMMITTED to
// public/, so the production build never depends on sharp. Re-run only when the
// brand mark changes: `pnpm -F frontend gen-icons`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const PUBLIC = join(dirname(dirname(fileURLToPath(import.meta.url))), "public");
const SRC = join(PUBLIC, "favicon.svg");
const PAPER = "#faf6ef"; // --paper, matches the manifest background_color

/** Render the cloud mark centered on a square paper tile, with `pad` safe-zone. */
async function render(size, pad, out) {
  const inner = Math.round(size * (1 - pad * 2));
  const mark = await sharp(readFileSync(SRC), { density: 384 })
    .resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: mark, gravity: "center" }])
    .png()
    .toFile(join(PUBLIC, out));
  process.stdout.write(`>> ${out} (${size}x${size})\n`);
}

await render(192, 0.08, "pwa-192x192.png");
await render(512, 0.08, "pwa-512x512.png");
await render(512, 0.18, "maskable-512x512.png"); // wider safe zone for maskable crop
process.stdout.write(">> PWA icons generated\n");
```

- [ ] **Step 5: Generate the icons**

Run: `pnpm -F frontend gen-icons`
Expected: three `>> pwa-*.png` lines, then `>> PWA icons generated`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm -F frontend test:preflight`
Expected: PASS — `PWA icons exist at the declared sizes`.

- [ ] **Step 7: Commit**

```bash
git add frontend/app/scripts/gen-icons.mjs frontend/app/scripts/pwa-icons.test.mjs \
  frontend/app/public/pwa-192x192.png frontend/app/public/pwa-512x512.png \
  frontend/app/public/maskable-512x512.png frontend/app/package.json frontend/pnpm-lock.yaml
git commit -m "$(printf 'feat(pwa): generate installable app icons from the brand mark\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Service worker + manifest + registration (installable, offline-capable build)

**Files:**
- Modify: `frontend/app/vite.config.ts` (add the PWA plugin + Workbox config; add e2e-offline to Vitest exclude)
- Modify: `frontend/app/src/main.tsx` (register the service worker)
- Create: `frontend/app/src/vite-env.d.ts` **only if it does not already exist** (PWA virtual-module types)
- Create: `frontend/app/public/_headers` (Cloudflare Pages: no-cache the SW + manifest)
- Test: `frontend/app/scripts/pwa-build.test.mjs`
- Modify: `frontend/app/package.json` (no new script; `vite-plugin-pwa` devDep added via pnpm)

**Interfaces:**
- Consumes: the three icon files from Task 1.
- Produces: a build that emits `dist/sw.js` + `dist/manifest.webmanifest`; a registered, auto-updating service worker; runtime-cache routes for fonts + the HF model + jsDelivr; precache that excludes `bundle/**`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/scripts/pwa-build.test.mjs`:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(APP, "dist");

test("build:pages emits an installable, bundle-safe service worker", () => {
  const r = spawnSync("pnpm", ["run", "build:pages"], { cwd: APP, stdio: "inherit", env: process.env });
  assert.equal(r.status, 0, "build:pages failed");

  assert.ok(existsSync(join(DIST, "sw.js")), "dist/sw.js missing");
  assert.ok(existsSync(join(DIST, "manifest.webmanifest")), "dist/manifest.webmanifest missing");

  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.webmanifest"), "utf8"));
  assert.ok(manifest.icons?.some((i) => i.sizes === "192x192"), "no 192 icon");
  assert.ok(manifest.icons?.some((i) => i.sizes === "512x512"), "no 512 icon");
  assert.ok(manifest.icons?.some((i) => i.purpose === "maskable"), "no maskable icon");

  // The bundle is copied into dist/bundle AFTER the build; the precache must never list it.
  const sw = readFileSync(join(DIST, "sw.js"), "utf8");
  assert.ok(!/bundle\//.test(sw), "service worker precache must exclude bundle/**");
}, { timeout: 180_000 });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test frontend/app/scripts/pwa-build.test.mjs`
Expected: FAIL — `dist/sw.js missing` (no PWA plugin yet).

- [ ] **Step 3: Install `vite-plugin-pwa`**

Run: `pnpm -F frontend add -D vite-plugin-pwa`
Expected: installs cleanly with no Vite peer-dep error. If it errors against `vite ^8`, install the latest version that supports Vite 8.

- [ ] **Step 4: Configure the plugin in `vite.config.ts`**

Replace the contents of `frontend/app/vite.config.ts` with:

```ts
/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";

// The PWA plugin is build-time only; keep it out of Vitest so unit specs are
// byte-for-byte unaffected (registration lives in main.tsx, which tests never load).
const pwa = process.env.VITEST
  ? []
  : [
      VitePWA({
        registerType: "autoUpdate",
        includeAssets: ["favicon.svg", "icons.svg"],
        manifest: {
          name: "Nimbus — the everything store",
          short_name: "Nimbus",
          description:
            "A storefront that re-ranks toward your taste, live, on your device.",
          theme_color: "#ff4d2e",
          background_color: "#faf6ef",
          display: "standalone",
          // Relative — the plugin resolves these against VITE_BASE for apex + subpath deploys.
          start_url: ".",
          scope: ".",
          icons: [
            { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
            { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
            {
              src: "maskable-512x512.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Precache the built shell; NEVER the signed catalog bundle (large + mutable).
          globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm}"],
          globIgnores: ["**/bundle/**"],
          // Same-origin ONNX/zstd WASM can exceed the 2 MB default — allow up to 32 MB.
          maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
          // SPA: serve index.html for navigations the precache can't match (offline reload).
          navigateFallback: "index.html",
          // The signed bundle origin is cross-origin in the Docker shape; never fall back to it.
          navigateFallbackDenylist: [/\/bundle\//],
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.googleapis.com",
              handler: "StaleWhileRevalidate",
              options: { cacheName: "google-fonts-stylesheets" },
            },
            {
              urlPattern: ({ url }) => url.origin === "https://fonts.gstatic.com",
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts-files",
                expiration: { maxEntries: 16, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // The embedding model — the SW owns its offline cache (transformers.js
              // browser cache is disabled in Task 3). resolve/main URLs follow LFS
              // redirects internally, so the huggingface.co request URL is the cache key.
              urlPattern: ({ url }) =>
                url.hostname.endsWith("huggingface.co") || url.hostname.endsWith("hf.co"),
              handler: "CacheFirst",
              options: {
                cacheName: "edgereco-model",
                expiration: { maxEntries: 64, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
            {
              // transformers.js may pull the ONNX runtime WASM from jsDelivr.
              urlPattern: ({ url }) => url.hostname === "cdn.jsdelivr.net",
              handler: "CacheFirst",
              options: {
                cacheName: "edgereco-wasm",
                expiration: { maxEntries: 32, maxAgeSeconds: 60 * 60 * 24 * 365 },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ];

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), ...pwa],
  base: process.env.VITE_BASE ?? "/",
  server: { port: 5174, strictPort: true },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test-setup.ts"],
    exclude: [
      ...configDefaults.exclude,
      "tests/e2e/**",
      "tests/e2e-c1/**",
      "tests/e2e-offline/**",
      "scripts/**",
    ],
  },
});
```

- [ ] **Step 5: Register the service worker in `main.tsx`**

Edit `frontend/app/src/main.tsx` — add the registration import and call (keep the existing render):

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App.tsx";
import "./index.css";

// Auto-update: a new shell is fetched in the background and taken over on the next
// load. Bundle updates flow through OPFS sync independently of this. No-ops where
// service workers are unavailable.
registerSW({ immediate: true });

const rootElement = document.getElementById("root");
if (rootElement === null) throw new Error("Root element #root not found");
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6: Add PWA virtual-module types**

If `frontend/app/src/vite-env.d.ts` exists, add the reference line below to it; otherwise create it with:

```ts
/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />
```

- [ ] **Step 7: Add the Cloudflare Pages headers file**

Create `frontend/app/public/_headers`:

```
# Keep the service worker and manifest fresh so updates propagate immediately.
/sw.js
  Cache-Control: public, max-age=0, must-revalidate
/manifest.webmanifest
  Cache-Control: public, max-age=0, must-revalidate
```

- [ ] **Step 8: Run typecheck, lint, and the build test**

Run: `pnpm -F frontend typecheck && pnpm -F frontend lint`
Expected: both pass (the `virtual:pwa-register` type resolves via the client types).

Run: `node --test frontend/app/scripts/pwa-build.test.mjs`
Expected: PASS — installable, bundle-safe service worker emitted.

- [ ] **Step 9: Run the unit suite to confirm no regression**

Run: `pnpm -F frontend test`
Expected: PASS (PWA plugin is disabled under VITEST; existing specs unchanged).

- [ ] **Step 10: Commit**

```bash
git add frontend/app/vite.config.ts frontend/app/src/main.tsx frontend/app/src/vite-env.d.ts \
  frontend/app/public/_headers frontend/app/scripts/pwa-build.test.mjs \
  frontend/app/package.json frontend/pnpm-lock.yaml
git commit -m "$(printf 'feat(pwa): service worker + manifest + autoUpdate registration\n\nWorkbox precaches the app shell (bundle excluded), runtime-caches fonts and\nthe HF model; manifest + icons make the storefront installable.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 3: Make the service worker the single owner of the model cache

**Files:**
- Modify: `frontend/packages/edgeproc-browser/src/engine/embedder.ts`
- Test: `frontend/packages/edgeproc-browser/src/engine/embedder.test.ts` (create if absent; otherwise add the case)

**Interfaces:**
- Produces: transformers.js `env.useBrowserCache === false` at module load, so model fetches fall through to the service worker's `edgereco-model` CacheFirst route (Task 2) instead of being double-stored by the library.

- [ ] **Step 1: Write the failing test**

Create `frontend/packages/edgeproc-browser/src/engine/embedder.test.ts` (or append the test if the file exists):

```ts
import { env } from "@huggingface/transformers";
import { describe, expect, it } from "vitest";
import "./embedder";

describe("embedder model cache ownership", () => {
  it("disables the transformers.js browser cache so the service worker owns it", () => {
    expect(env.useBrowserCache).toBe(false);
  });
});
```

(Confirm the package's test command — likely `pnpm --filter @edgeproc/browser test` running Vitest. Use the package's existing runner.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @edgeproc/browser test`
Expected: FAIL — `expected true to be false` (library default is `true`).

- [ ] **Step 3: Disable the library cache in `embedder.ts`**

In `frontend/packages/edgeproc-browser/src/engine/embedder.ts`, change the transformers.js import and add the config right after it:

```ts
import { env, pipeline } from "@huggingface/transformers";

// The PWA service worker owns the model's offline cache (a CacheFirst route over
// the HuggingFace host). Disable transformers.js's own Cache-API copy so there is
// a single owner and we don't double-store ~25 MB. In Node (the parity test) this
// is a no-op — the library uses a filesystem cache there, not the browser cache.
env.useBrowserCache = false;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @edgeproc/browser test`
Expected: PASS — including the existing parity tests (the env change is inert in Node).

- [ ] **Step 5: Typecheck + lint the package**

Run: `pnpm --filter @edgeproc/browser typecheck && pnpm --filter @edgeproc/browser lint`
(Use the package's actual script names if they differ; match the existing ones.)
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/packages/edgeproc-browser/src/engine/embedder.ts \
  frontend/packages/edgeproc-browser/src/engine/embedder.test.ts
git commit -m "$(printf 'feat(pwa): let the service worker own the model cache\n\nDisable the transformers.js browser cache so the SW CacheFirst route is the\nsingle owner of the ~25 MB model for offline use. No-op in Node parity tests.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 4: OfflineBadge component

**Files:**
- Create: `frontend/app/src/components/OfflineBadge.tsx`
- Test: `frontend/app/src/components/OfflineBadge.test.tsx`
- Modify: `frontend/app/src/index.css` (append `.offline-badge` styles)

**Interfaces:**
- Produces: `export function OfflineBadge(): JSX.Element | null` — renders `null` when online; renders a `.offline-badge` element with the text `Offline — running fully on your device` when `navigator.onLine` is false. Subscribes to window `online`/`offline` events. Consumed by App in Task 6.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/src/components/OfflineBadge.test.tsx`:

```tsx
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfflineBadge } from "./OfflineBadge";

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  act(() => {
    window.dispatchEvent(new Event(value ? "online" : "offline"));
  });
}

afterEach(() => vi.restoreAllMocks());

describe("OfflineBadge", () => {
  it("renders nothing while online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<OfflineBadge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the on-device message when the browser goes offline", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    render(<OfflineBadge />);
    setOnline(false);
    expect(
      screen.getByText("Offline — running fully on your device"),
    ).toBeInTheDocument();
  });

  it("hides again when connectivity returns", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineBadge />);
    expect(screen.getByText(/Offline/)).toBeInTheDocument();
    setOnline(true);
    expect(screen.queryByText(/Offline/)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F frontend test -- OfflineBadge`
Expected: FAIL — cannot resolve `./OfflineBadge`.

- [ ] **Step 3: Implement the component**

Create `frontend/app/src/components/OfflineBadge.tsx`:

```tsx
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * A subtle badge shown only when the browser is actually offline. The message is
 * the product thesis surfaced as a positive: the engine runs on the device, so a
 * dropped connection is a non-event. It never lies about connectivity.
 */
export function OfflineBadge(): JSX.Element | null {
  const online = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  if (online) {
    return null;
  }
  return (
    <div className="offline-badge" role="status">
      Offline — running fully on your device
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F frontend test -- OfflineBadge`
Expected: PASS — all three cases.

- [ ] **Step 5: Add styles**

Append to `frontend/app/src/index.css`:

```css
/* =========================================================================
   PWA — offline badge + install pill (fixed, unobtrusive, brand-consistent)
   ========================================================================= */

.offline-badge {
  position: fixed;
  left: 50%;
  bottom: 18px;
  transform: translateX(-50%);
  z-index: 10000;
  padding: 8px 16px;
  border-radius: 999px;
  background: var(--abyss);
  color: var(--paper);
  font-size: 13px;
  font-weight: 500;
  box-shadow: var(--shadow-lift);
}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/app/src/components/OfflineBadge.tsx \
  frontend/app/src/components/OfflineBadge.test.tsx frontend/app/src/index.css
git commit -m "$(printf 'feat(pwa): honest offline badge (runs on your device)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 5: Install affordance (useInstallPrompt hook + InstallButton)

**Files:**
- Create: `frontend/app/src/pwa/useInstallPrompt.ts`
- Create: `frontend/app/src/components/InstallButton.tsx`
- Test: `frontend/app/src/pwa/useInstallPrompt.test.tsx`
- Modify: `frontend/app/src/index.css` (append `.install-pill` styles)

**Interfaces:**
- Produces:
  - `useInstallPrompt(): { canInstall: boolean; promptInstall: () => Promise<void> }` — captures `beforeinstallprompt`, suppresses the default mini-infobar, exposes whether an install is available, and triggers the native prompt; `canInstall` flips to false once the choice is made or the app is installed.
  - `export function InstallButton(): JSX.Element | null` — renders a dismissible `.install-pill` button "Install app" only when `canInstall`; hidden otherwise. Consumed by App in Task 6.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/src/pwa/useInstallPrompt.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "./useInstallPrompt";

/** Build a fake beforeinstallprompt event with a controllable userChoice. */
function bipEvent(outcome: "accepted" | "dismissed") {
  const evt = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
    preventDefault: () => void;
  };
  evt.preventDefault = vi.fn();
  evt.prompt = vi.fn().mockResolvedValue(undefined);
  evt.userChoice = Promise.resolve({ outcome });
  return evt;
}

describe("useInstallPrompt", () => {
  it("is not installable until beforeinstallprompt fires", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
  });

  it("becomes installable and suppresses the default infobar", () => {
    const { result } = renderHook(() => useInstallPrompt());
    const evt = bipEvent("accepted");
    act(() => {
      window.dispatchEvent(evt);
    });
    expect(evt.preventDefault).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(true);
  });

  it("prompts and stops being installable after the choice", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const evt = bipEvent("accepted");
    act(() => {
      window.dispatchEvent(evt);
    });
    await act(async () => {
      await result.current.promptInstall();
    });
    expect(evt.prompt).toHaveBeenCalled();
    expect(result.current.canInstall).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm -F frontend test -- useInstallPrompt`
Expected: FAIL — cannot resolve `./useInstallPrompt`.

- [ ] **Step 3: Implement the hook**

Create `frontend/app/src/pwa/useInstallPrompt.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

/** The non-standard install prompt event (Chromium). Typed locally — not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the browser's install prompt so the app can offer an in-page "Install"
 * affordance instead of relying on the easily-missed address-bar icon. `canInstall`
 * is true only while a deferred prompt is in hand; it clears once the user chooses
 * or the app is installed.
 */
export function useInstallPrompt(): {
  canInstall: boolean;
  promptInstall: () => Promise<void>;
} {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    function onBip(event: Event) {
      event.preventDefault(); // suppress the default mini-infobar; we drive the prompt
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
    }
    window.addEventListener("beforeinstallprompt", onBip);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (deferred === null) {
      return;
    }
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null); // a deferred prompt can only be used once
  }, [deferred]);

  return { canInstall: deferred !== null, promptInstall };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm -F frontend test -- useInstallPrompt`
Expected: PASS — all three cases.

- [ ] **Step 5: Implement the InstallButton**

Create `frontend/app/src/components/InstallButton.tsx`:

```tsx
import { useInstallPrompt } from "../pwa/useInstallPrompt";

/** A small, dismissible "Install app" pill shown only when the browser offers it. */
export function InstallButton(): JSX.Element | null {
  const { canInstall, promptInstall } = useInstallPrompt();
  if (!canInstall) {
    return null;
  }
  return (
    <button
      type="button"
      className="install-pill"
      onClick={() => {
        void promptInstall();
      }}
    >
      Install app
    </button>
  );
}
```

- [ ] **Step 6: Add styles**

Append to `frontend/app/src/index.css`:

```css
.install-pill {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 10000;
  padding: 9px 16px;
  border: 0;
  border-radius: 999px;
  background: var(--signal);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
  box-shadow: var(--shadow-lift);
}
```

- [ ] **Step 7: Typecheck + lint + commit**

Run: `pnpm -F frontend typecheck && pnpm -F frontend lint && pnpm -F frontend test`
Expected: all pass.

```bash
git add frontend/app/src/pwa/useInstallPrompt.ts frontend/app/src/pwa/useInstallPrompt.test.tsx \
  frontend/app/src/components/InstallButton.tsx frontend/app/src/index.css
git commit -m "$(printf 'feat(pwa): in-app install affordance\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 6: Mount the overlays in App

**Files:**
- Modify: `frontend/app/src/App.tsx`
- Modify: `frontend/app/src/App.test.tsx` (add an assertion that the badge is absent when online)

**Interfaces:**
- Consumes: `OfflineBadge` (Task 4), `InstallButton` (Task 5).
- Produces: both overlays render at the App root across every launch state (Landing, Boot, Storefront).

- [ ] **Step 1: Write the failing test**

Add to `frontend/app/src/App.test.tsx` (inside the existing top-level `describe`, or as a new test):

```tsx
it("does not show the offline badge while online", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  render(<App />);
  expect(
    screen.queryByText("Offline — running fully on your device"),
  ).not.toBeInTheDocument();
});
```

Ensure the file imports `vi`, `screen`, and `render` (most are already present — add only what's missing).

- [ ] **Step 2: Run the test to verify it fails or passes-trivially**

Run: `pnpm -F frontend test -- App`
Expected: PASS trivially (the badge isn't mounted yet) — this test guards against a future regression where the badge shows while online. Proceed; the real behavior change is in Step 3, covered by the OfflineBadge unit tests.

- [ ] **Step 3: Refactor App to render the overlays at the root**

Edit `frontend/app/src/App.tsx`: add the imports, compute the current screen into a variable, and return a fragment with the overlays. Replace the three trailing `return` branches (lines ~53–60) with:

```tsx
import { InstallButton } from "./components/InstallButton";
import { OfflineBadge } from "./components/OfflineBadge";
// ...existing imports unchanged...

// (inside App, replacing the final three returns)
  const screen = !launched ? (
    <Landing onLaunch={onLaunch} />
  ) : !ready ? (
    <BootScreen stage={stage} error={error} onRetry={onRetry} />
  ) : (
    <Storefront />
  );

  return (
    <>
      {screen}
      <OfflineBadge />
      <InstallButton />
    </>
  );
```

Also update the stale line in the App docstring (~line 19): change "the HTTP cache the model" to "the service worker the app shell + model" so the comment matches the new caching reality.

- [ ] **Step 4: Run typecheck, lint, and the unit suite**

Run: `pnpm -F frontend typecheck && pnpm -F frontend lint && pnpm -F frontend test`
Expected: all pass — including the existing App/Landing/Storefront specs (overlays render `null` in their default online/non-installable state, so no existing assertion breaks).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/src/App.tsx frontend/app/src/App.test.tsx
git commit -m "$(printf 'feat(pwa): mount offline badge + install pill at the app root\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 7: Offline end-to-end proof

**Files:**
- Create: `frontend/app/playwright.offline.config.ts`
- Create: `frontend/app/tests/e2e-offline/offline.spec.ts`
- Modify: `frontend/app/package.json` (add `test:e2e:offline` script)

**Interfaces:**
- Consumes: the full PWA build (Tasks 1–6) and the existing `tests/e2e-c1/catalog-server.mjs` (a static origin for the signed bundle, port via `CATALOG_PORT`).
- Produces: a Playwright run that builds the app (bundle pointed at the offline catalog server), previews the real build, warms it online, cuts the network, reloads, and asserts the store mounts and ranks offline.

- [ ] **Step 1: Add the offline Playwright config**

Create `frontend/app/playwright.offline.config.ts`:

```ts
import { defineConfig, devices } from "@playwright/test";

/**
 * Offline PROOF — runs against a PREVIEW of the production build so the REAL
 * generated service worker (precache + runtime caches) is active. Unlike the
 * main e2e suite, the embedder is NOT stubbed: the real ~25 MB model loads once
 * online, the SW caches it, and the offline reload must serve it from cache.
 */
const CATALOG_PORT = 8921; // distinct from the main e2e's 8920
const PREVIEW_PORT = 5175; // distinct from the dev server's 5174

export default defineConfig({
  testDir: "tests/e2e-offline",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 240_000, // a real model download happens once, online
  expect: { timeout: 60_000 },
  use: {
    baseURL: `http://localhost:${PREVIEW_PORT}`,
    headless: true,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `npx vite preview --port ${PREVIEW_PORT} --strictPort`,
      url: `http://localhost:${PREVIEW_PORT}/public.key`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: "node tests/e2e-c1/catalog-server.mjs",
      url: `http://localhost:${CATALOG_PORT}/public.key`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { CATALOG_PORT: String(CATALOG_PORT) },
    },
  ],
});
```

- [ ] **Step 2: Add the `test:e2e:offline` script**

In `frontend/app/package.json` `scripts`, add (the build inlines the offline catalog origin so the previewed build syncs from port 8921):

```json
"test:e2e:offline": "VITE_BUNDLE_BASE_URL=http://localhost:8921/catalog pnpm run build && playwright test -c playwright.offline.config.ts"
```

- [ ] **Step 3: Write the offline spec**

Create `frontend/app/tests/e2e-offline/offline.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * THE airplane-mode proof. After one online sync the whole store works with the
 * network cut: the SW serves the shell + model, OPFS holds the bundle. Because
 * boot warms the embedder model before the Storefront mounts, a Storefront that
 * mounts OFFLINE is itself proof the model was served from cache.
 */
const PRODUCT_CARD = "main article.card button.card__overlay";
const OFFLINE_BADGE = ".offline-badge";

async function launch(page: import("@playwright/test").Page): Promise<void> {
  await page.getByRole("button", { name: "▶ Launch the live demo" }).click();
  await expect(page.locator(PRODUCT_CARD).first()).toBeVisible({ timeout: 180_000 });
}

test("storefront works fully offline after one online sync", async ({ page, context }) => {
  // 1. Warm online: the SW installs + caches the shell and model; OPFS gets the bundle.
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await launch(page);

  // 2. Cut the network at the browser context.
  await context.setOffline(true);

  // 3. Reload. Shell ← SW precache, bundle ← OPFS fallback, model ← SW cache.
  await page.reload();
  await launch(page); // mounts offline ⇒ model + bundle + shell all served without network
  await expect(page.locator(OFFLINE_BADGE)).toBeVisible();
  await expect(page.locator("h2:text-is('Recommended for you')")).toBeVisible();

  await page.screenshot({ path: "test-results/offline.png", fullPage: true });
});
```

- [ ] **Step 4: Run the offline proof for real**

Run: `pnpm -F frontend test:e2e:offline`
Expected: PASS — `storefront works fully offline after one online sync`. Watch the run: the first `launch` is slow (real model download); the post-offline `launch` is fast (served from cache). Inspect `test-results/offline.png` to confirm the grid + offline badge render.

**If it fails at the offline reload** (white screen, or boot hangs at "loading model"): capture which request hit the network after `setOffline(true)` with `page.on("requestfailed", ...)`. Most likely the HF model fetch isn't matching the `edgereco-model` route (LFS-redirect host, or a range request). Fixes, in order: (a) widen the `huggingface.co`/`hf.co` route or add the redirect host; (b) add Workbox `RangeRequestsPlugin` to the model route; (c) fall back to re-enabling `env.useBrowserCache = true` in `embedder.ts` (belt-and-suspenders) while the SW still covers the shell + fonts. Re-run until green.

- [ ] **Step 5: Run the full main suite to confirm no regression**

Run: `pnpm -F frontend test && pnpm -F frontend test:preflight && pnpm -F frontend test:e2e`
Expected: all green (the main e2e suite still uses `vite dev`, where the SW is inactive, so it is unchanged).

- [ ] **Step 6: Commit**

```bash
git add frontend/app/playwright.offline.config.ts frontend/app/tests/e2e-offline/offline.spec.ts \
  frontend/app/package.json
git commit -m "$(printf 'test(pwa): offline end-to-end proof (airplane mode after one sync)\n\nBuilds + previews the real service worker, warms online, cuts the network,\nreloads, and asserts the store mounts and ranks offline.\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Post-implementation (after all tasks green)

- **Docs:** update `README.md` (or the relevant section) and `docs/DEPLOY.md` to note the storefront is an installable, offline-capable PWA after first sync, and that `_headers` keeps the SW fresh on Cloudflare Pages. Run the `docs-sync` skill to catch drift. (Handle as a follow-up commit, not part of a task's TDD loop.)
- **Manual validation:** `pnpm -F frontend build:pages && pnpm -F frontend preview`, open in a real browser, install to the dock/home screen, then toggle DevTools → Network → Offline and reload to watch the store work. This is the human end-to-end check beyond the automated proof.
- **Branch finish:** use `superpowers:finishing-a-development-branch` to merge `pwa-offline` and delete it (no dangling branches).

## Self-review notes (planner)

- **Spec coverage:** offline contract → Tasks 2 (caching) + 7 (proof); SW-owns-model → Task 3; manifest+icons → Tasks 1–2; install affordance → Task 5; offline badge → Task 4; autoUpdate → Task 2; `_headers` → Task 2; base-path → Global Constraints + Task 2; build ordering / bundle-never-cached → Task 2 test; honest degradation (images, latest) → covered by offline-by-nature in Task 7 + globIgnores. All spec sections map to a task.
- **Type consistency:** `OfflineBadge` (no props), `InstallButton` (no props), `useInstallPrompt(): { canInstall, promptInstall }` are used identically in their tests, in App (Task 6), and in InstallButton (Task 5). `env.useBrowserCache` name matches in Task 3 test + impl.
- **Known risk carried into execution:** the HF LFS-redirect host / range-request behavior for the model route — Task 7 Step 4 has the explicit debug-and-fix path and the `useBrowserCache` fallback.
