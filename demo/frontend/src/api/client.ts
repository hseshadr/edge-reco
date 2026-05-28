// The data layer — backend-free. Every call that used to hit the FastAPI backend
// now runs the in-browser engine (@edgeproc/browser) over the synced signed bundle:
//
//   search()   -> engine.search(query)        (embed in-tab -> BM25⊕vector -> RRF -> rerank)
//   recommend()-> engine.recommend()          (popularity pool reranked by the live profile)
//   browse()   -> engine.browse()             (catalog listing over products.jsonl)
//   sendEvent()-> fold the click into the in-tab SessionProfile  (NO network)
//
// The whole point of the demo lives in sendEvent: a click updates the in-browser
// profile, so the very next recommend() re-ranks toward your taste — entirely
// in-tab, no round trip. The SearchResponse/RecommendResponse/BrowseResponse
// shapes are byte-identical to the old HTTP contract, so the components that
// consume this module did not change.
//
// bootstrap() must resolve before any of these calls (App gates the UI on it).

import {
	applyInteraction,
	configFromEnv,
	EngineRuntime,
	emptyProfile,
	type OnStage,
	type RuntimeConfig,
	type RuntimeDeps,
	type SearchEngine,
	type SessionProfile,
} from "@edgeproc/browser";
import type {
	BrowseResponse,
	InteractionEvent,
	Product,
	RecommendResponse,
	SearchResponse,
} from "./types";

interface SearchOptions {
	readonly limit?: number;
	readonly category?: string;
}

interface BrowseOptions {
	readonly category?: string;
	readonly limit?: number;
	readonly offset?: number;
}

let runtime = new EngineRuntime();

/** The live, in-tab session profile — folded forward by each click event. */
let profile: SessionProfile = emptyProfile();
/** Product lookup the events path resolves clicked ids against. */
let productById: ReadonlyMap<string, Product> = new Map();

function requireEngine(): SearchEngine {
	const engine = runtime.engine();
	if (engine === null) {
		throw new Error("engine not ready — call bootstrap() first");
	}
	return engine;
}

/**
 * Spin up the engine Workers, sync the signed bundle into OPFS, and warm the
 * embedder. Idempotent and progress-reporting. Resolve before any data call.
 */
export async function bootstrap(
	onStage: OnStage = () => {},
	config: RuntimeConfig = configFromEnv(),
): Promise<void> {
	const engine = await runtime.bootstrap(config, onStage);
	productById = new Map(engine.catalog().map((p) => [p.id, p]));
}

/**
 * Test seam: rebind the runtime to one with injected Worker/embedder deps and
 * clear the session, so a unit test can bootstrap over fixture data without a
 * browser. Not used by the app, which always uses the default Worker-backed
 * runtime.
 */
export function __setRuntimeForTests(deps: RuntimeDeps): void {
	runtime = new EngineRuntime(deps);
	profile = emptyProfile();
	productById = new Map();
}

/** Reset the in-tab session (fresh taste); used by tests + an explicit reset. */
export function resetSession(): void {
	profile = emptyProfile();
}

export function search(
	q: string,
	opts?: SearchOptions,
): Promise<SearchResponse> {
	return requireEngine().search(q, {
		profile,
		...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
		...(opts?.category !== undefined ? { category: opts.category } : {}),
	});
}

export function recommend(limit?: number): Promise<RecommendResponse> {
	const engine = requireEngine();
	return Promise.resolve(
		engine.recommend({
			profile,
			...(limit !== undefined ? { limit } : {}),
		}),
	);
}

export function browse(opts?: BrowseOptions): Promise<BrowseResponse> {
	const engine = requireEngine();
	return Promise.resolve(
		engine.browse({
			...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
			...(opts?.category !== undefined ? { category: opts.category } : {}),
		}),
	);
}

/**
 * Fold a click (or any interaction) into the in-tab profile — no network. The
 * next recommend()/search() picks up the new affinities; this is the live
 * re-rank loop. Unknown product ids are ignored, matching the backend's events
 * route. Resolves once the profile is updated.
 */
export function sendEvent(evt: InteractionEvent): Promise<void> {
	const product = productById.get(evt.product_id);
	if (product !== undefined) {
		profile = applyInteraction(profile, product, evt.event_type);
	}
	return Promise.resolve();
}

/** Catalog summary — the in-tab equivalent of the backend's /catalog/info. */
export function catalogInfo(): Promise<{ readonly count: number }> {
	return Promise.resolve({ count: requireEngine().ntotal });
}
