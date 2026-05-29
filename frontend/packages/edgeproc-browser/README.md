# @edgeproc/browser

**The in-browser tier of edge-proc.** Sync a signed, content-addressed catalog
bundle into OPFS (ed25519 + sha256, fail-closed), reassemble its index files,
and run the full hybrid-search + session-aware reranker — BM25 ⊕ vector → RRF →
rerank — entirely in the tab. No application backend in the request path.

This is the engine the [Nimbus storefront demo](../../README.md) runs on. It
publishes the same wire format and the same scoring formula as the Python core
in [`src/edgereco/`](../../../src/edgereco) — the two are top-k parity-tested
against the same committed bundle (see `src/engine/hybridParity.test.ts`).

> **Status:** private pnpm workspace member of `edge-reco`. Not published to npm.
> Reusable by other workspace packages today; a public release will follow once
> the package surface stabilizes.

## TL;DR

```ts
import { EngineRuntime, configFromEnv } from "@edgeproc/browser";

// In your SPA: spin up the sync + embedder Workers, pull and verify the signed
// bundle into OPFS, load the embedding model. Resolves with a SearchEngine.
const runtime = new EngineRuntime();
const engine = await runtime.bootstrap(configFromEnv(), (stage) => {
	console.log("boot stage:", stage.kind); // syncing | reassembling | loading-model | ready
});

const results = await engine.search("wireless headphones", { limit: 10 });
const recs = engine.recommend({ limit: 10 }); // session-aware (folds in clicks)
```

`configFromEnv()` reads `VITE_BUNDLE_BASE_URL` (the Caddy edge serving the
signed bundle) and pins the public key to `<your-app-origin>/public.key` — the
key is **never** fetched from the bundle origin (that would defeat pinning).

## Parity with the Python core

The browser embedder is `Xenova/all-MiniLM-L6-v2` via
[`@huggingface/transformers`](https://huggingface.co/docs/transformers.js) with
`{ pooling: "mean", normalize: true }` — the byte-for-byte equivalent of the
Python core's `sentence-transformers` recipe. The vector index is loaded from
the same prebuilt `vector/embeddings.f32` file the FastAPI runtime reads. The
BM25 tokenizer, RRF fusion (`k=60`), and the rerank scoring formula
(`0.40·pop + 0.20·cat + 0.15·tag + 0.10·brand + 0.10·fresh − 0.25·rep`) all
match `src/edgereco/` line for line. The package's parity tests round-trip a
real query through both engines against the same committed bundle and assert
top-k by score group.

## Architecture (two Workers, off the UI thread)

```
SPA tab
├── EngineRuntime.bootstrap(config)
│     ├── sync Worker   (worker.ts)
│     │     └── pull /latest -> verify ed25519 -> fetch chunks ->
│     │         verify sha256 -> reassemble files into OPFS
│     └── embedder Worker (embedderWorker.ts)
│           └── load Xenova/all-MiniLM-L6-v2 (~25 MB) -> ONNX session
└── SearchEngine
      ├── search(q)       embed(q) -> BM25 ⊕ vector -> RRF -> session rerank
      ├── recommend()     popularity pool -> session rerank
      └── browse()        catalog listing
```

Both Workers are lazy: the model is fetched only on the first `embed()`; the
bundle is fetched only on the first `bootstrap()`. After the first run the
bundle lives in OPFS and the model lives in the HTTP cache, so reloads are
near-instant and offline-capable.

## Package layout

- `EngineRuntime` / `RuntimeConfig` / `RuntimeDeps` — the bootstrap front door.
- `SearchEngine` / `createSearchEngine` — the search surface (`search`,
  `recommend`, `browse`). Built once over the synced bundle.
- `EngineClient` — a thin wrapper around the sync Worker, used by the C1
  Playwright harness.
- `Product` / `SearchResult` / `ScoreComponents` / `InteractionEvent` — the
  domain types the engine produces. Same shapes as the Python core's wire
  contract.
- `applyInteraction` / `buildProfile` / `emptyProfile` / `SessionProfile` —
  the in-tab session profile, folded forward by each interaction event.
- `createEmbedder` — the default transformers.js-backed embedder, exposed so
  call sites that only want the embedder (e.g. server-side parity tests) can
  build one without a Worker.

The `./testing` subpath exposes the fixture loader plus the lower-level sync
primitives (`MemoryCacheStore`, `syncIndex`, `materializeFile`, the `Verify` /
`FetchBytes` / `CacheStore` types) so that consumers' tests can drive an
in-memory sync over the committed bundle without a network or a browser. None
of those are part of the production surface.

## Implementation notes

- **`pipeline as unknown as LoadFeatureExtraction` double cast in
  `src/engine/embedder.ts`.** transformers.js' `pipeline()` is overloaded over
  every task; the union explodes the TypeScript compiler (TS2590,
  "type instantiation is excessively deep"). The double cast collapses it to
  the one feature-extraction signature this module uses. Not a smell — keep it
  unless you upgrade to a transformers.js release that ships narrower types.

- **Embedder seam.** `RuntimeDeps.makeEmbedder` is the production seam for
  swapping the transformers.js embedder out — e.g. a stub for end-to-end
  tests that should not wait on the ~25 MB model download. Production
  passes the real Worker-backed embedder.
