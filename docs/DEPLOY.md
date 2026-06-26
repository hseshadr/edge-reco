# Deploy

EdgeReco ships in two shapes. Pick the one that matches the request you want to answer:

| Shape | Where search runs | Who you serve from | When to use |
|---|---|---|---|
| **Backend-free, in-browser** | The user's tab | Any static HTTP / CDN | Public storefronts, low-latency UX, offline-capable, no app-server bill |
| **Edge-origin API server** | A FastAPI process at the edge | Your edge nodes / k8s / lambda | Server-side ranking, secret signal fusion, integrations that don't run in a browser |

Both deliver the same scoring; the bundle contract is identical.

## Shape 1 — Backend-free (the headline demo)

![artifact distribution](diagrams/artifact-distribution-flow.svg)

Architecture:

- A static **origin** holds the signed bundle (`latest` + `manifest/<hash>` + `chunk/<hash>` + the actual `embeddings.f32` / `products.jsonl` / FAISS index, plus the signed `ranking_config.json` scoring-weights + strategy map and the `cooccurrence.json` item-to-item neighbour map).
- A **Caddy edge** fronts the origin with the right cache policy (immutable chunks + manifest, short-TTL pointer, permissive CORS).
- The **Nimbus SPA** is a static bundle. The browser pins a public key at build time, syncs the bundle into OPFS, verifies, then runs the engine in the tab.

There is **no application backend in the request path**. The browser does the work.

```yaml
# frontend/docker-compose.yml — abridged (omits the `name: nimbus-demo`
# project name, the demo `collector` service, and healthchecks; see the
# file itself for the full config). Modulo your TLS cert.
services:
  origin:
    image: python:3.13-slim
    volumes: ["../backend/examples/catalog:/catalog:ro"]
    command: ["python", "-m", "http.server", "8080"]

  edge:
    image: caddy:2-alpine
    ports: ["8081:8081"]
    volumes:
      - ../backend/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro

  frontend:
    build:
      context: .
      dockerfile: app/Dockerfile
      args:
        VITE_BUNDLE_BASE_URL: http://localhost:8081
    ports: ["5174:5174"]
```

For real production: replace the localhost ports with TLS + a real CDN in front of `origin/`. The browser only needs to reach the **edge** and trust the pinned public key.

### Caching policy (Caddy)

```caddyfile
:8081 {
    # /latest: short TTL (small file, must propagate fast)
    @latest path /latest
    header @latest Cache-Control "public, max-age=30, must-revalidate"

    # /manifest/* and /chunk/*: immutable (content-addressed)
    @immutable path /manifest/* /chunk/*
    header @immutable Cache-Control "public, max-age=31536000, immutable"

    # CORS for the browser sync
    header Access-Control-Allow-Origin "*"
    header Access-Control-Allow-Methods "GET, HEAD"

    file_server
}
```

A one-line edit to the index re-publishes one chunk; every consumer fetches one chunk and reuses the rest.

### Hosting the public demo on Cloudflare Pages (canonical)

The live demo at **https://edge-reco.com** is the backend-free shape served as plain
static files from Cloudflare Pages — no Caddy, no origin server. The build bundles the
signed catalog **same-origin** (copied into `dist/bundle`), so the whole flywheel runs
from one domain with zero CORS and zero application backend.

Create a Pages project (Cloudflare → Workers & Pages → Create → Pages → Connect to Git
→ `hseshadr/edge-reco`) with this build config:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `pnpm -F frontend run build:pages` |
| Build output directory | `app/dist` |
| Node version | from `frontend/.node-version` (22) |

No build environment variables are required: `build:pages` defaults to `VITE_BASE=/`
(apex root) and `VITE_BUNDLE_BASE_URL=bundle` (the same-origin copy), and leaves
`VITE_EVENTS_URL` unset so the hosted demo makes **zero backend calls after sync**. The
SPA has no client-side router (state-based Landing → Boot → Storefront), so no SPA
fallback / 404 rule is needed.

**The build also emits a service worker and a web app manifest**, making the storefront
an installable, offline-capable PWA. The service worker (Workbox via `vite-plugin-pwa`,
auto-update strategy) precaches the app shell and owns the embedding-model cache
(~25 MB). The signed catalog bundle stays OPFS-owned — the service worker never caches
it, so ed25519 + sha256 integrity is unchanged.

A `frontend/app/public/_headers` file instructs Cloudflare Pages to serve `sw.js` and
`manifest.webmanifest` with `Cache-Control: max-age=0, must-revalidate`, so service
worker updates propagate immediately on the next page load. No extra Pages configuration
is required for offline support — it is on by default in the Pages build.

Then add the apex domain in the Pages project → **Custom domains** → `edge-reco.com`.
Cloudflare provisions the DNS record (CNAME-flattening at the apex) and the TLS
certificate automatically. CF rebuilds and redeploys on every push to `main`.

> **Fork note:** to host your fork on a GitHub Pages *project* site instead (served
> under `https://<you>.github.io/<repo>/`), run the same `build:pages` with
> `VITE_BASE=/<repo>/` — the engine absolutizes the bundle + pinned-key URLs at
> runtime (`src/api/bundleUrl.ts`, `document.baseURI`), so one build works at any base.

## Shape 2 — Edge-origin API server

The same engine, but the **FastAPI runtime** does the search server-side. The SPA (or any client) calls `/search`, `/recommend`, `/events`.

```yaml
# backend/deploy/docker-compose.yml — server-side deployment
services:
  origin:
    image: python:3.13-slim
    volumes: ["../examples/catalog:/catalog:ro"]
    command: ["python", "-m", "http.server", "8080"]

  edge:
    image: caddy:2-alpine
    ports: ["8081:8081"]
    volumes: ["./caddy/Caddyfile:/etc/caddy/Caddyfile:ro"]

  demo:
    build:
      context: ..
      dockerfile: deploy/Dockerfile
    ports: ["8000:8000"]
    environment:
      EDGERECO_BUNDLE_BASE_URL: http://edge:8081
      EDGERECO_VERIFY_KEY_PATH: /app/examples/keys/public.key
```

The demo container syncs the signed bundle from `edge:8081` at startup, then serves search/recommend over `:8000`. CORS is configured for the storefront origin.

For multi-region: stamp the same container in each region; each replica syncs the bundle locally on cold start and serves recommendations from RAM. Bundle updates roll out by publishing a new `latest`; consumers pick it up on the next sync window (or on a signal).

## Bundle lifecycle in production

![manifest lifecycle](diagrams/manifest-lifecycle.svg)

Publisher (build CI):

```bash
edgereco build-catalog new-products.csv staging/products.jsonl
edgereco index staging staging
edgereco bundle staging origin examples/keys/private.key \
    --catalog-id products --version "$VERSION"
aws s3 sync origin/ s3://my-bundle-bucket/products/ --delete-after-sync
```

The pointer flip (`latest` upload) is the only thing the consumer reacts to. Chunks are immutable, so the order of upload doesn't matter as long as the pointer goes last.

## Security model

The trust boundary is **the pinned public key**:

- The SPA build embeds `frontend/app/public/public.key`. Replace it in your fork to bind your own trust root.
- The FastAPI runtime reads `EDGERECO_VERIFY_KEY_PATH` from env. Mount it as a secret.

Everything an attacker could swap (chunks, manifest, pointer) is verified locally. A forged pointer fails the signature check; a tampered chunk fails its content-address check. Both exit non-zero — `serve` refuses to start, the SPA shows a sync failure.

**Never ship the private key.** It signs on the publisher only.

## Operational notes

- **Cold start**: the first sync downloads the full bundle (~10 MB for the demo catalog). Subsequent syncs only fetch chunks that changed.
- **Offline**: once synced, both tiers are fully offline-capable. The SPA keeps working with `origin` + `edge` down; the FastAPI runtime keeps serving from cache.
- **Observability**: the backend tier exports a bounded telemetry ring (`backend/src/edgereco/telemetry/`). Hook it up to your sink of choice.
- **Flywheel uplink (the "events back to the cloud" loop)**: the SPA captures each interaction in-tab (clicks, favorites, cart-adds, capped dwell views), persists it (localStorage), and periodically flushes a batched, fire-and-forget beacon to the FastAPI `/events` collector — entirely **off the inference path**. It's **off by default** (`VITE_EVENTS_URL` unset → zero backend calls, the headline). `poe demo-flywheel` brings up the worked example: the `collector` container (the `demo_server` `/events` + CORS) is the mimicked cloud, and the SPA runs with `VITE_EVENTS_URL` pointing at the per-run collector port (`:8000` only on the standalone `docker compose up` path). The collector records into the telemetry ring above.
- **Flywheel retrain (the cloud half that closes the loop)**: `edgereco retrain` (and the `poe demo-retrain` worked example) pulls aggregated engagement from the collector's `GET /events/export`, recomputes each product's `popularity_score` (intent-graded: cart 4× · favorite 3× · click 1× · view 0.2×) **and the `cooccurrence.json` item-to-item neighbour map** (from a `--sessions` JSONL session log, same engagement grading via cosine similarity), and **republishes a freshly signed bundle** (new `latest`) — reusing the prebuilt FAISS `vector/` verbatim (both are text-independent data, so nothing is re-embedded). Both tiers re-sync the new popularity + co-occurrence with **no scoring-formula change**. In the demo, the edge serves a writable **runtime origin** (`.demo-origin`, gitignored) seeded from the committed bundle, so retrain republishes there without mutating the committed seed; the edge's short-TTL `latest` (30s, `must-revalidate`) means a browser refresh picks up the new bundle. Re-signing requires the producer's private key (`examples/keys/private.key`, gitignored) — retrain is a maintainer/cloud operation, like `edgereco bundle`. The read-only `edgereco audit BUNDLE_BASE_URL VERIFY_KEY --sessions LOG` previews exactly what a retrain would change (event counts, top popularity movers, changed co-occurrence edges) without signing, publishing, or touching the inference path.
- **Sibling repos in Docker**: the demo_server `Dockerfile` builds with the context rooted at `~/dev/oss/` (three repos side-by-side) so `../edge-proc` and `../shared-libs-python` resolve. See its top comment.
