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
import { type CooccurrenceMatrix, parseCooccurrence } from "./cooccurrence";
import { createEmbedder, type Embedder } from "./embedder";
import { createWorkerEmbedder, spawnEmbedderWorker } from "./embedderClient";
import { parseRankingConfig, type RankingConfig } from "./rankingConfig";
import { createSearchEngine, type SearchEngine } from "./searchEngine";
import type { SyncResult } from "./types";
import type { VectorIndexFiles } from "./vectorIndex";

/** The four bundle files the in-browser index is assembled from. */
const META_PATH = "catalog_meta.json";
const STATE_PATH = "vector/state.json";
const EMBEDDINGS_PATH = "vector/embeddings.f32";
const PRODUCTS_PATH = "products.jsonl";
/** The signed ranking weights; absent on bundles that predate the feature. */
const RANKING_CONFIG_PATH = "ranking_config.json";
/** The signed co-occurrence matrix; absent on bundles that predate Phase 3. */
const COOCCURRENCE_PATH = "cooccurrence.json";

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
	readonly expectedBundleId?: string;
	readonly expectedChannel?: string;
}

/** The sync-Worker surface bootstrap needs: pull the bundle, read its files. */
export interface EnginePort {
	sync(
		baseUrl: string,
		pubkeyUrl: string,
		expectedBundleId?: string,
		expectedChannel?: string,
	): Promise<SyncResult>;
	readFile(path: string): Promise<Uint8Array>;
	/** Release the sync worker once the bundle is materialized. */
	dispose?(): void;
	/** Legacy lifecycle alias for worker-backed ports. */
	terminate?(): void;
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

/**
 * Read an OPTIONAL bundle file, distinguishing ABSENT from a real error. The sync
 * layer signals "this file predates the bundle" with a typed `file <path> not in
 * manifest` rejection (sync.ts `fileEntry`); that — and ONLY that — maps to
 * `undefined` so the caller degrades to its default. Any other rejection (a read/
 * IPC failure, a corrupt chunk) propagates so the bootstrap fails CLOSED instead of
 * silently masking a real fault as "older bundle".
 */
export async function readOptionalBundleFile(
	engine: EnginePort,
	path: string,
): Promise<Uint8Array | undefined> {
	try {
		return await engine.readFile(path);
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === `file ${path} not in manifest`
		) {
			return undefined;
		}
		throw error;
	}
}

/**
 * Read the bundle's VERIFIED ranking_config.json — it rides in the signed
 * manifest, so engine.readFile materializes it through the same ed25519/sha256
 * path as catalog_meta.json (no out-of-band fetch, no verification bypass). A
 * bundle that predates the file has no such manifest entry (→ undefined → typed
 * default). A present-but-malformed file throws in parseRankingConfig (fail-closed),
 * and an unexpected read error propagates from readOptionalBundleFile.
 */
async function readRankingConfig(engine: EnginePort): Promise<RankingConfig> {
	const bytes = await readOptionalBundleFile(engine, RANKING_CONFIG_PATH);
	return parseRankingConfig(bytes);
}

/**
 * Read the bundle's VERIFIED cooccurrence.json the SAME way as ranking_config.json:
 * it rides in the signed manifest, so engine.readFile materializes it through the
 * ed25519/sha256 path (no out-of-band fetch, no verification bypass). A bundle that
 * predates Phase 3 has no such manifest entry (→ undefined → empty matrix). A
 * present-but-malformed file throws in parseCooccurrence (fail-closed), and an
 * unexpected read error propagates from readOptionalBundleFile.
 */
async function readCooccurrence(
	engine: EnginePort,
): Promise<CooccurrenceMatrix> {
	const bytes = await readOptionalBundleFile(engine, COOCCURRENCE_PATH);
	return parseCooccurrence(bytes);
}

/** Read Vite env into a RuntimeConfig; the pubkey is pinned same-origin. */
export function configFromEnv(): RuntimeConfig {
	const bundleBaseUrl = import.meta.env.VITE_BUNDLE_BASE_URL;
	// The pinned key ships in the SPA build (public/public.key), served from the
	// app's OWN trusted origin — never fetched from the untrusted bundle origin.
	const pubkeyUrl = new URL("public.key", document.baseURI).toString();
	const expectedBundleId = import.meta.env.VITE_BUNDLE_ID ?? "amazon-demo";
	const expectedChannel = import.meta.env.VITE_BUNDLE_CHANNEL ?? "stable";
	return { bundleBaseUrl, pubkeyUrl, expectedBundleId, expectedChannel };
}

/**
 * Sync the signed bundle, warm the embedder, and build the in-tab SearchEngine.
 * Idempotent — the first call wins and its result is cached for the tab.
 */
export class EngineRuntime {
	readonly #deps: RuntimeDeps;
	#enginePromise: Promise<SearchEngine> | null = null;
	#ready: SearchEngine | null = null;
	#enginePort: EnginePort | null = null;
	#embedder: Embedder | null = null;
	#generation = 0;

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
			const generation = this.#generation;
			this.#enginePromise = this.#build(config, onStage, generation).catch(
				(error) => {
					// Let a failed bootstrap be retried by clearing the memo. A stale
					// build must not clear a newer attempt after explicit dispose().
					if (this.#generation === generation) {
						this.#enginePromise = null;
					}
					throw error;
				},
			);
		}
		return this.#enginePromise;
	}

	async #build(
		config: RuntimeConfig,
		onStage: OnStage,
		generation: number,
	): Promise<SearchEngine> {
		let engineClient: EnginePort | null = null;
		let embedder: Embedder | null = null;
		try {
			engineClient = this.#deps.spawnEngine();
			this.#enginePort = engineClient;
			onStage({ kind: "syncing" });
			const result = await engineClient.sync(
				config.bundleBaseUrl,
				config.pubkeyUrl,
				config.expectedBundleId,
				config.expectedChannel,
			);
			this.#assertCurrent(generation);
			onStage({ kind: "synced", result });

			onStage({ kind: "reassembling" });
			const [files, rankingConfig, cooccurrence] = await Promise.all([
				readBundleFiles(engineClient),
				readRankingConfig(engineClient),
				readCooccurrence(engineClient),
			]);
			// The sync worker has done its job; release OPFS/IPC resources before
			// loading the model so the two largest allocations do not overlap.
			this.#releaseEngine(engineClient);
			engineClient = null;
			this.#assertCurrent(generation);

			onStage({ kind: "loading-model" });
			embedder = this.#deps.makeEmbedder();
			this.#embedder = embedder;
			// Force the ~25 MB model download/compile now so "loading-model" reflects
			// real work and the first user query is fast.
			await embedder.embed(WARMUP_PROMPT);
			this.#assertCurrent(generation);

			const engine = await createSearchEngine(
				files,
				embedder,
				rankingConfig,
				cooccurrence,
			);
			this.#assertCurrent(generation);
			this.#ready = engine;
			onStage({ kind: "ready" });
			return engine;
		} catch (error) {
			if (engineClient !== null) {
				this.#releaseEngine(engineClient);
			}
			if (embedder !== null) {
				this.#releaseEmbedder(embedder);
			}
			throw error;
		}
	}

	/** Release both worker-backed resources and permit a fresh bootstrap. */
	public dispose(): void {
		this.#generation += 1;
		this.#enginePromise = null;
		this.#ready = null;
		const enginePort = this.#enginePort;
		this.#enginePort = null;
		if (enginePort !== null) {
			disposeResource(enginePort);
		}
		const embedder = this.#embedder;
		this.#embedder = null;
		if (embedder !== null) {
			disposeResource(embedder);
		}
	}

	#assertCurrent(generation: number): void {
		if (generation !== this.#generation) {
			throw new Error("engine runtime disposed during bootstrap");
		}
	}

	#releaseEngine(enginePort: EnginePort): void {
		if (this.#enginePort !== enginePort) {
			return;
		}
		this.#enginePort = null;
		disposeResource(enginePort);
	}

	#releaseEmbedder(embedder: Embedder): void {
		if (this.#embedder !== embedder) {
			return;
		}
		this.#embedder = null;
		disposeResource(embedder);
	}
}

interface DisposableResource {
	dispose?: () => void;
	terminate?: () => void;
}

function disposeResource(resource: DisposableResource): void {
	if (resource.dispose !== undefined) {
		resource.dispose();
		return;
	}
	resource.terminate?.();
}

/** Re-exported so call sites that only need the pure embedder can build one. */
export { createEmbedder };
