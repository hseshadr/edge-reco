// The browser runtime that turns the synced signed bundle into a live, in-tab
// SearchEngine — the in-browser replacement for the FastAPI backend.
//
// Two Workers, off the UI thread:
//   - the sync Worker (worker.ts) owns OPFS + the ported sync_index; it pulls the
//     signed, content-addressed bundle from the Caddy origin, verifies it
//     ed25519+sha256 fail-closed, and materializes the four index files;
//   - the embedder Worker (embedderWorker.ts) owns transformers.js: the ~25 MB
//     all-MiniLM-L6-v2 weights download + ONNX inference.
//
// bootstrap() drives both with a progress callback so the UI can show real
// stages (syncing bundle… loading model…). It is idempotent: the engine is
// built once and cached; later calls return the same instance. After the first
// run everything needed to search lives in OPFS + the HTTP cache, so reloads
// are offline-capable (a re-sync over a reachable origin fetches zero chunks).

import { EngineClient } from "./client";
import { createEmbedder, type Embedder } from "./embedder";
import { createWorkerEmbedder, spawnEmbedderWorker } from "./embedderClient";
import { createSearchEngine, type SearchEngine } from "./searchEngine";
import type { SyncResult } from "./types";
import type { VectorIndexFiles } from "./vectorIndex";

/** The four bundle files the in-browser index is assembled from. */
const META_PATH = "catalog_meta.json";
const STATE_PATH = "vector/state.json";
const EMBEDDINGS_PATH = "vector/embeddings.f32";
const PRODUCTS_PATH = "products.jsonl";

/** Any non-empty string warms the ONNX session; content is discarded. */
const WARMUP_PROMPT = "warm up the model";

/** A bootstrap stage, surfaced to the UI for a real progress story. */
export type BootStage =
	| { readonly kind: "syncing" }
	| { readonly kind: "synced"; readonly result: SyncResult }
	| { readonly kind: "reassembling" }
	| { readonly kind: "loading-model" }
	| { readonly kind: "ready" };

/** Progress sink; called as bootstrap advances through its stages. */
export type OnStage = (stage: BootStage) => void;

/** Where the bundle is synced from + the pinned verify key, from Vite env. */
export interface RuntimeConfig {
	/** Caddy origin serving the signed bundle (`/latest`, `/manifest/*`, `/chunk/*`). */
	readonly bundleBaseUrl: string;
	/** Same-origin URL of the pinned ed25519 public key (NOT the bundle origin). */
	readonly pubkeyUrl: string;
}

/** The sync-Worker surface bootstrap needs: pull the bundle, read its files. */
export interface EnginePort {
	sync(baseUrl: string, pubkeyUrl: string): Promise<SyncResult>;
	readFile(path: string): Promise<Uint8Array>;
}

/** The seams bootstrap depends on; defaulted to the real Workers, faked in tests. */
export interface RuntimeDeps {
	readonly spawnEngine: () => EnginePort;
	readonly makeEmbedder: () => Embedder;
}

const defaultDeps: RuntimeDeps = {
	spawnEngine: () => EngineClient.spawn(),
	makeEmbedder: () => createWorkerEmbedder(spawnEmbedderWorker()),
};

/**
 * Build the production runtime deps (real sync Worker + real transformers.js
 * embedder Worker). Exposed so consumers can compose — e.g. swap one field in
 * a test without re-implementing the other.
 */
export function defaultRuntimeDeps(): RuntimeDeps {
	return defaultDeps;
}

async function readBundleFiles(engine: EnginePort): Promise<VectorIndexFiles> {
	const [meta, state, embeddings, products] = await Promise.all([
		engine.readFile(META_PATH),
		engine.readFile(STATE_PATH),
		engine.readFile(EMBEDDINGS_PATH),
		engine.readFile(PRODUCTS_PATH),
	]);
	return { meta, state, embeddings, products };
}

/** Read Vite env into a RuntimeConfig; the pubkey is pinned same-origin. */
export function configFromEnv(): RuntimeConfig {
	const bundleBaseUrl = import.meta.env.VITE_BUNDLE_BASE_URL;
	// The pinned key ships in the SPA build (public/public.key), served from the
	// app's OWN trusted origin — never fetched from the untrusted bundle origin.
	const pubkeyUrl = new URL("public.key", document.baseURI).toString();
	return { bundleBaseUrl, pubkeyUrl };
}

/**
 * Sync the signed bundle, warm the embedder, and build the in-tab SearchEngine.
 * Idempotent — the first call wins and its result is cached for the tab.
 */
export class EngineRuntime {
	readonly #deps: RuntimeDeps;
	#enginePromise: Promise<SearchEngine> | null = null;
	#ready: SearchEngine | null = null;

	public constructor(deps: RuntimeDeps = defaultDeps) {
		this.#deps = deps;
	}

	/** The ready engine, or null before the first successful bootstrap. */
	public engine(): SearchEngine | null {
		return this.#ready;
	}

	/** Build (or reuse) the engine over the synced bundle, reporting progress. */
	public bootstrap(
		config: RuntimeConfig,
		onStage: OnStage = () => {},
	): Promise<SearchEngine> {
		if (this.#enginePromise === null) {
			this.#enginePromise = this.#build(config, onStage).catch((error) => {
				// Let a failed bootstrap be retried by clearing the memo.
				this.#enginePromise = null;
				throw error;
			});
		}
		return this.#enginePromise;
	}

	async #build(config: RuntimeConfig, onStage: OnStage): Promise<SearchEngine> {
		const engineClient = this.#deps.spawnEngine();
		onStage({ kind: "syncing" });
		const result = await engineClient.sync(
			config.bundleBaseUrl,
			config.pubkeyUrl,
		);
		onStage({ kind: "synced", result });

		onStage({ kind: "reassembling" });
		const files = await readBundleFiles(engineClient);

		onStage({ kind: "loading-model" });
		const embedder = this.#deps.makeEmbedder();
		// Force the ~25 MB model download/compile now so "loading-model" reflects
		// real work and the first user query is fast.
		await embedder.embed(WARMUP_PROMPT);

		const engine = await createSearchEngine(files, embedder);
		this.#ready = engine;
		onStage({ kind: "ready" });
		return engine;
	}
}

/** Re-exported so call sites that only need the pure embedder can build one. */
export { createEmbedder };
