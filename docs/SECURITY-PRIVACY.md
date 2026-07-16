# Security and privacy contract

## TL;DR

The hosted Nimbus demo downloads a public, signed catalog and runs queries and
personalization inside the browser. The production build has no analytics uplink or
application API configured. Catalog integrity fails closed; personal signals stay in
tab memory; remote catalog image URLs render as local placeholders instead of making
third-party requests. This document separates those facts from the optional collector.

## Trust boundaries and threat model

| Boundary | Trusted input | Enforced behavior | Residual risk |
|---|---|---|---|
| Browser app origin | Reviewed static JS, public key, model and WASM | CSP limits code/data connections to self; no third-party fonts, model, runtime, or query API | A first-load compromise of the app origin can replace both JS and its key. Bundle signing does not cure a compromised application origin. |
| Catalog CDN / bundle bytes | Ed25519 public key shipped with the app | Signed pointer, manifest and chunk hashes verify before promotion; malformed ranking/vector/co-occurrence data fails closed | A previously valid signed release can be replayed unless the deployment layer enforces freshness. Do not expose the signing private key to CI or Docker. |
| Browser device | OPFS, CacheStorage and in-memory profile | Catalog/model caches contain public artifacts; search and recommendation use local Workers with 60 s engine and 300 s first-embed deadlines | Anyone with device/browser-profile access can inspect public catalog artifacts and the optional local event queue. |
| Optional event collector | Explicit `VITE_EVENTS_URL` and operator-set bearer token | Batches ≤1,000; session IDs ≤200 chars; event ring ≤10,000; sessions ≤10,000 and expire after 1 hour idle | The demo permits an intentionally open collector when `EDGERECO_EVENTS_TOKEN` is unset. Never expose that shape to an untrusted network. |
| Production deploy | GitHub CI SHA and scoped Cloudflare credentials | Missing secrets fail red; Cloudflare must report the exact successful commit; `www` must permanently redirect to the apex | DNS/Cloudflare settings are external state and still require post-deploy verification and rollback drills. |

The main hostile cases are tampered or truncated bundle bytes, malformed signed data,
Worker crash/silence, oversized event input, session-memory exhaustion, dependency or
container-context leakage, and a deploy that reports success without serving the
reviewed commit. The tests and release workflow name each corresponding failure
boundary; no integrity error falls back to unverified data.

## Privacy and egress inventory

| Data | Default hosted demo | Storage / retention | Network egress |
|---|---|---|---|
| Search text | Processed in the embedder/search Workers | Memory for the active operation; not persisted by EdgeReco | None after bundle/model sync |
| Click, view, favorite, cart | Folded into the in-tab session profile | Memory only; reload resets it | None (`VITE_EVENTS_URL` is unset) |
| Catalog, embeddings, model, WASM, public key | Public release artifacts | OPFS, service-worker/transformers caches, HTTP cache | Same-origin sync/download only |
| Product images | Public Amazon media URLs remain in the research dataset but are not loaded | Local category/title placeholder only; a deployment may supply release-owned root-relative assets | None in the shipped app |
| Optional flywheel events | Product ID, event type, timestamp, random browser session ID | Queue capped at 500 in `localStorage` until acknowledged; collector ring capped at 10,000; session profile expires after 1 hour idle | Only to the explicitly configured `VITE_EVENTS_URL` |
| API-server search | Query and random/header session ID | Session profile in bounded memory | Client-to-API request; normal access logs may contain the URL query and must be governed by the operator |

There are no prompts, LLM providers, user embeddings, account records, backups, or
personal-data exports in this repository. Clearing site data removes OPFS/CacheStorage,
the optional queue, and the persisted optional-uplink session ID. The default demo's
disabled uplink is a no-op and does not create that ID or queue.

## Operator requirements

- Keep `VITE_EVENTS_URL` unset for the zero-backend public demo. If enabling it,
  disclose the collector and retention, set `EDGERECO_EVENTS_TOKEN`, terminate TLS,
  restrict CORS, apply edge rate limits, and define deletion/export operations before
  accepting real-user traffic.
- Keep the Ed25519 private key outside Git, CI build artifacts, Docker contexts, logs,
  and backups that are not explicitly protected as signing-key material.
- Treat API access logs as search-history data. Disable query logging or set a short,
  documented retention period appropriate to the deployment.
- A green release requires local gates, exact-sha Cloudflare identity, canonical-host,
  real-domain header/MIME/cache checks, clean browser console/network, and a tested
  rollback to an immutable Pages deployment.
