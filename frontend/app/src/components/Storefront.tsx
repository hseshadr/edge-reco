import type { TFunction } from "i18next";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { resolveBundleBaseUrl } from "../api/bundleUrl";
import {
	browse,
	catalogInfo,
	recommendStrategy,
	search,
	similar,
	strategies,
} from "../api/client";
import type { EventType, Product, SearchResult, Strategy } from "../api/types";
import { startMetricsObservers } from "../metrics/observe";
import { record } from "../metrics/store";
import { emitInteraction } from "../signals/emit";
import { useDwellViews } from "../signals/useDwellViews";
import { useDebounced } from "../useDebounced";
import { Header } from "./Header";
import { MetricsStrip } from "./MetricsStrip";
import type { PdpRail } from "./ProductDetail";
import { ProductDetail } from "./ProductDetail";
import { ProductGrid } from "./ProductGrid";
import { type RailData, RailStack } from "./RailStack";
import {
	coBuyRails,
	homeRails,
	trendingInCategoryLabel,
} from "./railSelection";
import { SyncBadge } from "./SyncBadge";
import { Toast } from "./Toast";

const RAIL_LIMIT = 10;
const GRID_LIMIT = 24; // frozen: storefront grid page size
const TOAST_MS = 2200;

interface GridView {
	products: Product[];
	kicker: string;
	title: string;
}

/** Home shows the grid + stacked rails; product shows the PDP for one item. */
type View = { kind: "browse" } | { kind: "product"; product: Product };

/**
 * Empty results for a rail spec the engine returned nothing for (degrade). An
 * engine throw is REPORTED through `onError` (the app's error banner) before we
 * degrade, so a real fault (e.g. a fail-closed malformed-bundle error) is
 * user-visible — while the empty-rail UX means one bad rail never crashes the
 * page. A legitimately-empty co-occurrence rail resolves with `results: []`
 * and never lands here, so it isn't reported.
 */
async function loadRail(
	strategy: string,
	label: string,
	onError: (err: unknown) => void,
): Promise<RailData> {
	try {
		const res = await recommendStrategy(strategy, { limit: RAIL_LIMIT });
		return { spec: { strategy, label }, results: res.results };
	} catch (err) {
		onError(err);
		return { spec: { strategy, label }, results: [] };
	}
}

/**
 * Guarded vector-rail fetch: a throw hides the rail upstream. The throw is
 * REPORTED through `onError` (the error banner) before degrading so a real
 * engine fault is user-visible; an empty result is a normal value (resolves,
 * never throws) and is NOT reported — a cold/co-occurrence-less seed just
 * yields no rail.
 */
async function safeResults(
	run: () => Promise<{ results: SearchResult[] }>,
	onError: (err: unknown) => void,
): Promise<SearchResult[]> {
	try {
		return (await run()).results;
	} catch (err) {
		onError(err);
		return [];
	}
}

/**
 * The Nimbus storefront. Mounted only once the engine has bootstrapped, so its
 * data effects run against a ready in-tab engine — there is no network here:
 * search/recommend/browse run in-tab, and a click folds into the in-tab session
 * profile so the For-You rail re-ranks immediately (the demo's hero loop).
 * Clicking a product also opens a state-based PDP (no router) seeded with that
 * product's vector rails.
 */
export function Storefront() {
	const { t } = useTranslation("storefront");
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebounced(query, 300);
	const [activeCategory, setActiveCategory] = useState<string | null>(null);
	const [categories, setCategories] = useState<string[]>([]);

	const [grid, setGrid] = useState<GridView>(() => ({
		products: [],
		kicker: t("grid.kickerCatalog"),
		title: t("grid.titleBrowse"),
	}));
	const [gridLoading, setGridLoading] = useState(true);

	const [view, setView] = useState<View>({ kind: "browse" });
	const [rails, setRails] = useState<RailData[]>([]);
	const [pdpRails, setPdpRails] = useState<PdpRail[]>([]);
	const strategyMap = useRef<Record<string, Strategy>>({});

	// Explicit signals (click | favorite | cart) counted app-side: the engine's
	// parity-locked clickCount only counts clicks, and the badge + cold-start
	// gate must also register favorites/carts. Ambient views never count here.
	const [sessionSignals, setSessionSignals] = useState(0);
	const [cartCount, setCartCount] = useState(0);
	const [favoritedIds, setFavoritedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
	const [personalizing, setPersonalizing] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const toastTimer = useRef<number | undefined>(undefined);
	// Monotonic id for grid loads: a slow older search must not clobber a newer
	// one that already resolved (typing "de" then "desk" races two in-flight queries).
	const gridRequest = useRef(0);

	// The engine's own message verbatim when present, else the translated
	// "Unexpected error" fallback — the on-screen copy the error banner renders.
	const toErrorMessage = useCallback(
		(err: unknown): string =>
			err instanceof Error ? err.message : t("banner.unexpectedError"),
		[t],
	);

	// A degraded rail's fault lands in the same banner as every other engine
	// error — surfaced, retryable, and never page-crashing.
	const reportRailError = useCallback(
		(err: unknown) => setError(toErrorMessage(err)),
		[toErrorMessage],
	);

	const refreshRails = useCallback(async () => {
		setPersonalizing(true);
		try {
			const specs = homeRails(strategyMap.current);
			setRails(
				await Promise.all(
					specs.map((s) => loadRail(s.strategy, s.label, reportRailError)),
				),
			);
		} catch (err) {
			setError(toErrorMessage(err));
		} finally {
			setPersonalizing(false);
		}
	}, [toErrorMessage, reportRailError]);

	const loadPdpRails = useCallback(
		async (product: Product) => {
			const map = strategyMap.current;
			const similarLabel = map.similar_items?.label ?? "Similar items";
			const becauseLabel =
				map.because_viewed?.label ?? "Because you viewed this";
			// Co-occurrence rails (FBT first, also-bought second) — seed-driven, so a
			// cold/co-occurrence-less seed yields empty results and the rail is hidden.
			const [fbtSpec, alsoBoughtSpec] = coBuyRails(map);
			const [fbt, alsoBought, similarItems, because, trending] =
				await Promise.all([
					safeResults(
						() =>
							recommendStrategy("frequently_bought_together", {
								seed: product.id,
								limit: RAIL_LIMIT,
							}),
						reportRailError,
					),
					safeResults(
						() =>
							recommendStrategy("also_bought", {
								seed: product.id,
								limit: RAIL_LIMIT,
							}),
						reportRailError,
					),
					safeResults(
						() => similar(product.id, { limit: RAIL_LIMIT }),
						reportRailError,
					),
					safeResults(
						() =>
							recommendStrategy("because_viewed", {
								seed: product.id,
								limit: RAIL_LIMIT,
							}),
						reportRailError,
					),
					safeResults(
						() => recommendStrategy("trending", { limit: RAIL_LIMIT }),
						reportRailError,
					),
				]);
			setPdpRails([
				// "Frequently bought together" sits high, just below the hero.
				{
					key: "frequently_bought_together",
					label: fbtSpec?.label ?? "Frequently bought together",
					results: fbt,
				},
				{ key: "similar_items", label: similarLabel, results: similarItems },
				// "Customers who bought this also bought" below the similar rail.
				{
					key: "also_bought",
					label:
						alsoBoughtSpec?.label ?? "Customers who bought this also bought",
					results: alsoBought,
				},
				{ key: "because_viewed", label: becauseLabel, results: because },
				{
					key: "trending_category",
					label: trendingInCategoryLabel(product),
					results: trending.filter(
						(r) => r.product.category === product.category,
					),
				},
			]);
		},
		[reportRailError],
	);

	const loadGrid = useCallback(async () => {
		const seq = gridRequest.current + 1;
		gridRequest.current = seq;
		setGridLoading(true);
		setError(null);
		try {
			const next = await loadGridInner(debouncedQuery, activeCategory, t);
			// Latest-wins: drop a stale result whose newer query already landed.
			if (seq !== gridRequest.current) return;
			setCategories(next.categories);
			setGrid(next.grid);
		} catch (err) {
			// A superseded query's failure is not the current view — swallow it.
			if (seq === gridRequest.current) setError(toErrorMessage(err));
		} finally {
			// Only the latest request owns the loading flag.
			if (seq === gridRequest.current) setGridLoading(false);
		}
	}, [debouncedQuery, activeCategory, t, toErrorMessage]);

	useEffect(() => {
		void loadGrid();
	}, [loadGrid]);

	useEffect(() => {
		strategyMap.current = strategies();
		void refreshRails();
	}, [refreshRails]);

	useEffect(() => {
		return () => window.clearTimeout(toastTimer.current);
	}, []);

	// Live metrics: Storefront mounts only once the engine is ready, so now() is a
	// sound `readyAt` for the post-sync backend-call observer. We also record the
	// catalog size here (the engine's ntotal) — honest because the engine is ready.
	useEffect(() => {
		const stop = startMetricsObservers({
			readyAt: performance.now(),
			edgeOrigin: new URL(resolveBundleBaseUrl()).origin,
			eventsUrl: import.meta.env.VITE_EVENTS_URL,
		});
		void catalogInfo().then(({ count }) => record({ productCount: count }));
		return stop;
	}, []);

	const flashToast = useCallback((message: string) => {
		setToast(message);
		window.clearTimeout(toastTimer.current);
		toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
	}, []);

	const emitExplicit = useCallback(
		async (eventType: EventType, product: Product): Promise<boolean> => {
			try {
				const { emitted, message } = await emitInteraction(eventType, product);
				if (!emitted) return false;
				if (message !== null) flashToast(message);
				setSessionSignals((n) => n + 1);
				await refreshRails();
				return true;
			} catch (err) {
				setError(toErrorMessage(err));
				return false;
			}
		},
		[refreshRails, flashToast, toErrorMessage],
	);

	// A pick records the click (so For You keeps learning + last_viewed is set)
	// AND opens the PDP seeded with this product's vector rails.
	const onPick = useCallback(
		async (product: Product) => {
			await emitExplicit("click", product);
			setPdpRails([]);
			setView({ kind: "product", product });
			window.scrollTo({ top: 0 });
			void loadPdpRails(product);
		},
		[emitExplicit, loadPdpRails],
	);

	const onBack = useCallback(() => setView({ kind: "browse" }), []);

	const onFavorite = useCallback(
		async (product: Product) => {
			const wasFavorited = favoritedIds.has(product.id);
			setFavoritedIds((prev) => toggle(prev, product.id, wasFavorited));
			// Unfavoriting is visual-only: negative signals are deferred (spec).
			if (!wasFavorited) await emitExplicit("favorite", product);
		},
		[favoritedIds, emitExplicit],
	);

	const onAddToCart = useCallback(
		async (product: Product) => {
			if (await emitExplicit("cart", product)) setCartCount((n) => n + 1);
		},
		[emitExplicit],
	);

	const onDwell = useCallback(
		(product: Product) => {
			// Ambient impression: silent, uncounted, and failures never surface —
			// a missed view must not interrupt browsing (same spirit as the uplink).
			void emitInteraction("view", product)
				.then((outcome) => (outcome.emitted ? refreshRails() : undefined))
				.catch(() => undefined);
		},
		[refreshRails],
	);
	const registerDwell = useDwellViews(onDwell);

	const onSelectCategory = useCallback((category: string | null) => {
		setQuery("");
		setActiveCategory(category);
		setView({ kind: "browse" });
	}, []);

	// When a search query is active, surface its results at the TOP of the shop —
	// a labelled "Results for …" cue plus the grid, pinned right under the search
	// box — with the personalized rails sliding below. Without this a query paints
	// a 4th section beneath three unchanged rails and reads as if nothing happened.
	const searchedQuery = debouncedQuery.trim();
	const isSearching = searchedQuery !== "";
	const wasSearchingRef = useRef(false);
	useEffect(() => {
		if (isSearching && !wasSearchingRef.current) {
			// Entering search from browse: pull the freshly-surfaced results up.
			window.scrollTo({ top: 0, behavior: "smooth" });
		}
		wasSearchingRef.current = isSearching;
	}, [isSearching]);

	const railStack = (
		<RailStack
			rails={rails}
			onPick={onPick}
			personalizing={personalizing}
			signalCount={sessionSignals}
		/>
	);
	const productGrid = (
		<ProductGrid
			products={grid.products}
			kicker={grid.kicker}
			title={grid.title}
			loading={gridLoading}
			onPick={onPick}
			onFavorite={onFavorite}
			onAddToCart={onAddToCart}
			favoritedIds={favoritedIds}
			registerDwell={registerDwell}
		/>
	);

	return (
		<>
			<Header
				query={query}
				onQueryChange={setQuery}
				categories={categories}
				activeCategory={activeCategory}
				onSelectCategory={onSelectCategory}
				cartCount={cartCount}
			/>

			<MetricsStrip />

			{/* Browse gets a modifier: its grid (the page h1) precedes the rails in
			    DOM order for a sound heading outline, while CSS `order` keeps the
			    visual stack (rails above grid) unchanged. */}
			<main
				className={
					view.kind === "browse" && !isSearching ? "shop shop--browse" : "shop"
				}
			>
				{error !== null && (
					<div className="banner banner--error" role="alert">
						<div className="banner__title">{t("banner.title")}</div>
						<div>{error}</div>
						<button
							type="button"
							className="banner__retry"
							onClick={() => {
								void loadGrid();
								void refreshRails();
							}}
						>
							{t("banner.retry")}
						</button>
					</div>
				)}

				{view.kind === "product" ? (
					<ProductDetail
						product={view.product}
						rails={pdpRails}
						onBack={onBack}
						onPick={onPick}
					/>
				) : isSearching ? (
					<>
						<div className="results-cue" role="status" aria-live="polite">
							{t("grid.resultsFor", { query: searchedQuery })}
						</div>
						{productGrid}
						{railStack}
					</>
				) : (
					<>
						{productGrid}
						{railStack}
					</>
				)}
			</main>

			<SyncBadge />

			<Toast message={toast} />
		</>
	);
}

/** Toggle a product id in a readonly set without mutating it. */
function toggle(
	set: ReadonlySet<string>,
	id: string,
	present: boolean,
): ReadonlySet<string> {
	const next = new Set(set);
	if (present) next.delete(id);
	else next.add(id);
	return next;
}

/** The categories + grid a query/category resolves to (computed, not yet applied). */
interface GridResult {
	categories: string[];
	grid: GridView;
}

/**
 * Compute the grid + category list for the current query/category. Pure of state
 * writes so the caller can apply the result under a latest-wins guard — a stale
 * older query that resolves late is dropped rather than clobbering newer results.
 */
async function loadGridInner(
	debouncedQuery: string,
	activeCategory: string | null,
	t: TFunction,
): Promise<GridResult> {
	const trimmed = debouncedQuery.trim();
	if (trimmed !== "") {
		const res = await search(trimmed, { limit: GRID_LIMIT });
		const products = res.results.map((r) => r.product);
		return {
			categories: deriveCategories(products),
			grid: {
				products,
				kicker: t("grid.kickerSearch"),
				title: `"${trimmed}"`,
			},
		};
	}
	const res = await browse(
		activeCategory === null
			? { limit: GRID_LIMIT }
			: { limit: GRID_LIMIT, category: activeCategory },
	);
	return {
		categories: res.categories,
		grid: {
			products: res.products,
			kicker: t("grid.kickerCatalog"),
			title: activeCategory ?? t("grid.titleBrowse"),
		},
	};
}

/** Stable, sorted category list from a product set (used for search views). */
function deriveCategories(products: Product[]): string[] {
	return [...new Set(products.map((p) => p.category))].sort((a, b) =>
		a.localeCompare(b),
	);
}
