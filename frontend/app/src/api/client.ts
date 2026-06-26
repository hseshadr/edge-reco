// The data layer — backend-free. Every call that used to hit the FastAPI backend
// now runs the in-browser engine (@edgeproc/browser) over the synced signed bundle:
//
//   search()   -> engine.search(query)        (embed in-tab -> BM25⊕vector -> RRF -> rerank)
//   recommend()-> engine.recommend()          (popularity pool reranked by the live profile)
//   browse()   -> engine.browse()             (catalog listing over products.jsonl)
//   sendEvent()-> fold the click into the in-tab SessionProfile (NO network),
//                 and ALSO hand it to the flywheel uplink (off the inference
//                 path; disabled unless VITE_EVENTS_URL is set)
//
// The whole point of the demo lives in sendEvent: a click updates the in-browser
// profile, so the very next recommend() re-ranks toward your taste — entirely
// in-tab, no round trip. (The uplink is a separate, optional, fire-and-forget
// beacon — it never gates the rail re-rank.) The SearchResponse/RecommendResponse/BrowseResponse
// shapes are byte-identical to the old HTTP contract, so the components that
// consume this module did not change.
//
// bootstrap() must resolve before any of these calls (App gates the UI on it).

import {
	applyInteraction,
	configFromEnv,
	defaultRuntimeDeps,
	type Embedder,
	EngineRuntime,
	emptyProfile,
	type OnStage,
	type RuntimeConfig,
	type RuntimeDeps,
	type SearchEngine,
	type SessionProfile,
} from "@edgeproc/browser";
import { record } from "../metrics/store";
import { enqueueUplink } from "../telemetry/uplink";
import { resolveBundleBaseUrl } from "./bundleUrl";
import type {
	BrowseResponse,
	InteractionEvent,
	Product,
	RecommendResponse,
	SearchResponse,
	Strategy,
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

/**
 * Options for a strategy-aware recommend. `seed` is required by the vector
 * strategies (`similar_items` / `because_viewed`) and ignored by the rest.
 */
interface RecommendStrategyOptions {
	readonly limit?: number;
	readonly seed?: string;
}

/** Options for the seed-based similar-items rail. */
interface SimilarOptions {
	readonly limit?: number;
	readonly strategy?: string;
}

/**
 * Strategies that re-rank with the live session profile. The rest
 * (`trending`, `new_arrivals`, `similar_items`) are intentionally stable —
 * popularity/freshness/seed-driven — so they get an empty profile and never
 * shuffle as the user interacts.
 */
const PERSONALIZED_STRATEGIES: ReadonlySet<string> = new Set([
	"for_you",
	"because_viewed",
]);

/**
 * A test-only hook on `window` for the Playwright e2e: replaces the default
 * embedder factory before the App calls bootstrap, so the backend-free hero
 * loop can run against the REAL sync + REAL search engine without waiting on
 * the ~25 MB transformers.js model download (the one slow/flaky external
 * fetch). Production never sets it.
 *
 * Lives in the demo (not in `@edgeproc/browser`) because this is a property of
 * how this demo wires its e2e, not of the engine package itself.
 */
interface DemoTestHooks {
	readonly makeEmbedder?: () => Embedder;
}
declare global {
	interface Window {
		__edgeprocDemoTestHooks?: DemoTestHooks;
	}
}

/**
 * The app's runtime config: reuse the package's configFromEnv() (which pins
 * the verify key same-origin via document.baseURI) but absolutize the bundle
 * URL app-side, so an app-relative VITE_BUNDLE_BASE_URL (the GitHub Pages
 * build) reaches the sync Worker as the absolute URL it requires.
 */
function appRuntimeConfig(): RuntimeConfig {
	return { ...configFromEnv(), bundleBaseUrl: resolveBundleBaseUrl() };
}

/** The data-layer API. Created once per app/test session via createDataClient. */
export interface DataClient {
	bootstrap(onStage?: OnStage, config?: RuntimeConfig): Promise<void>;
	resetSession(): void;
	search(q: string, opts?: SearchOptions): Promise<SearchResponse>;
	recommend(limit?: number): Promise<RecommendResponse>;
	recommendStrategy(
		strategy: string,
		opts?: RecommendStrategyOptions,
	): Promise<RecommendResponse>;
	similar(productId: string, opts?: SimilarOptions): Promise<RecommendResponse>;
	strategies(): Record<string, Strategy>;
	catalog(): ReadonlyArray<Product>;
	browse(opts?: BrowseOptions): Promise<BrowseResponse>;
	sendEvent(evt: InteractionEvent): Promise<void>;
	catalogInfo(): Promise<{ readonly count: number }>;
}

/**
 * Build a data client over a fresh EngineRuntime. The closure captures the
 * runtime, the in-tab session profile, and the catalog id->product map; no
 * module-level mutable state is involved. Tests pass their own RuntimeDeps;
 * the production app uses `defaultRuntimeDeps()` (real Workers) with an
 * optional embedder override from `window.__edgeprocDemoTestHooks`.
 */
export function createDataClient(deps: Partial<RuntimeDeps> = {}): DataClient {
	const runtime = new EngineRuntime(resolveDeps(deps));
	let profile: SessionProfile = emptyProfile();
	let productById: ReadonlyMap<string, Product> = new Map();

	function requireEngine(): SearchEngine {
		const engine = runtime.engine();
		if (engine === null) {
			throw new Error("engine not ready — call bootstrap() first");
		}
		return engine;
	}

	return {
		async bootstrap(
			onStage: OnStage = () => {},
			config: RuntimeConfig = appRuntimeConfig(),
		): Promise<void> {
			const engine = await runtime.bootstrap(config, onStage);
			productById = new Map(engine.catalog().map((p) => [p.id, p]));
		},
		resetSession(): void {
			profile = emptyProfile();
		},
		search(q: string, opts?: SearchOptions): Promise<SearchResponse> {
			return requireEngine().search(q, {
				profile,
				...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
				...(opts?.category !== undefined ? { category: opts.category } : {}),
			});
		},
		recommend(limit?: number): Promise<RecommendResponse> {
			return Promise.resolve(
				requireEngine().recommend({
					profile,
					...(limit !== undefined ? { limit } : {}),
				}),
			);
		},
		recommendStrategy(
			strategy: string,
			opts?: RecommendStrategyOptions,
		): Promise<RecommendResponse> {
			const liveProfile = PERSONALIZED_STRATEGIES.has(strategy)
				? profile
				: emptyProfile();
			return Promise.resolve(
				requireEngine().recommend({
					profile: liveProfile,
					strategy,
					...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
					...(opts?.seed !== undefined ? { seed: opts.seed } : {}),
				}),
			);
		},
		similar(
			productId: string,
			opts?: SimilarOptions,
		): Promise<RecommendResponse> {
			// similar_items is a stable, seed-driven rail: empty profile so the
			// ordering depends on the seed, not the session.
			return Promise.resolve(
				requireEngine().similar(productId, {
					profile: emptyProfile(),
					...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
					...(opts?.strategy !== undefined ? { strategy: opts.strategy } : {}),
				}),
			);
		},
		strategies(): Record<string, Strategy> {
			return requireEngine().strategies();
		},
		catalog(): ReadonlyArray<Product> {
			return requireEngine().catalog();
		},
		browse(opts?: BrowseOptions): Promise<BrowseResponse> {
			return Promise.resolve(
				requireEngine().browse({
					...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
					...(opts?.category !== undefined ? { category: opts.category } : {}),
				}),
			);
		},
		sendEvent(evt: InteractionEvent): Promise<void> {
			const product = productById.get(evt.product_id);
			if (product !== undefined) {
				profile = applyInteraction(profile, product, evt.event_type);
			}
			// Off the inference path: a click ALSO feeds the flywheel uplink —
			// captured locally and later batched to the mimicked cloud. No-op when
			// the uplink is disabled (VITE_EVENTS_URL unset). Never blocks/throws.
			enqueueUplink(evt);
			return Promise.resolve();
		},
		catalogInfo(): Promise<{ readonly count: number }> {
			return Promise.resolve({ count: requireEngine().ntotal });
		},
	};
}

/**
 * Compose the final RuntimeDeps:
 *   explicit caller-passed dep > demo test hook (window) > package default.
 * The demo test hook is honored only for `makeEmbedder`; everything else uses
 * the real Worker-backed defaults from `@edgeproc/browser`.
 */
function resolveDeps(deps: Partial<RuntimeDeps>): RuntimeDeps {
	const base = defaultRuntimeDeps();
	const hookEmbedder =
		typeof window !== "undefined"
			? window.__edgeprocDemoTestHooks?.makeEmbedder
			: undefined;
	return {
		spawnEngine: deps.spawnEngine ?? base.spawnEngine,
		makeEmbedder: deps.makeEmbedder ?? hookEmbedder ?? base.makeEmbedder,
	};
}

// --- The singleton the demo's App + components consume ----------------------

let active: DataClient = createDataClient();

/**
 * Test seam: rebind the active client to one built with injected deps and
 * clear the session, so a unit test can bootstrap over fixture data without a
 * browser. Not used by the app, which always uses the default Worker-backed
 * client.
 */
export function __setRuntimeForTests(deps: RuntimeDeps): void {
	active = createDataClient(deps);
}

export function bootstrap(
	onStage?: OnStage,
	config?: RuntimeConfig,
): Promise<void> {
	return active.bootstrap(onStage, config);
}
export function resetSession(): void {
	active.resetSession();
}
export async function search(
	q: string,
	opts?: SearchOptions,
): Promise<SearchResponse> {
	const t0 = performance.now();
	const res = await active.search(q, opts);
	record({ searchMs: performance.now() - t0 });
	return res;
}
export async function recommend(limit?: number): Promise<RecommendResponse> {
	const t0 = performance.now();
	const res = await active.recommend(limit);
	record({ recommendMs: performance.now() - t0 });
	return res;
}
export async function recommendStrategy(
	strategy: string,
	opts?: RecommendStrategyOptions,
): Promise<RecommendResponse> {
	const t0 = performance.now();
	const res = await active.recommendStrategy(strategy, opts);
	record({ recommendMs: performance.now() - t0 });
	return res;
}
export async function similar(
	productId: string,
	opts?: SimilarOptions,
): Promise<RecommendResponse> {
	const t0 = performance.now();
	const res = await active.similar(productId, opts);
	record({ recommendMs: performance.now() - t0 });
	return res;
}
export function strategies(): Record<string, Strategy> {
	return active.strategies();
}
export function catalog(): ReadonlyArray<Product> {
	return active.catalog();
}
export function browse(opts?: BrowseOptions): Promise<BrowseResponse> {
	return active.browse(opts);
}
export function sendEvent(evt: InteractionEvent): Promise<void> {
	return active.sendEvent(evt);
}
export function catalogInfo(): Promise<{ readonly count: number }> {
	return active.catalogInfo();
}
