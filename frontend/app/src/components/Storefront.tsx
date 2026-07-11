import { useCallback, useEffect, useRef, useState } from "react";
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

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unexpected error";
}

/**
 * Empty results for a rail spec the engine returned nothing for (degrade). An
 * engine throw is LOGGED before we degrade so a real fault (e.g. a fail-closed
 * malformed-bundle error) stays visible in the console — we keep the empty-rail
 * UX so one bad rail never crashes the page. A legitimately-empty co-occurrence
 * rail resolves with `results: []` and never lands here, so it isn't logged.
 */
async function loadRail(strategy: string, label: string): Promise<RailData> {
	try {
		const res = await recommendStrategy(strategy, { limit: RAIL_LIMIT });
		return { spec: { strategy, label }, results: res.results };
	} catch (err) {
		console.warn(`rail "${strategy}" failed; rendering empty`, err);
		return { spec: { strategy, label }, results: [] };
	}
}

/**
 * Guarded vector-rail fetch: a throw hides the rail upstream. The throw is LOGGED
 * before degrading so a real engine fault is visible; an empty result is a normal
 * value (resolves, never throws) and is NOT logged — a cold/co-occurrence-less seed
 * just yields no rail.
 */
async function safeResults(
	run: () => Promise<{ results: SearchResult[] }>,
): Promise<SearchResult[]> {
	try {
		return (await run()).results;
	} catch (err) {
		console.warn("rail fetch failed; rendering empty", err);
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
	const [query, setQuery] = useState("");
	const debouncedQuery = useDebounced(query, 300);
	const [activeCategory, setActiveCategory] = useState<string | null>(null);
	const [categories, setCategories] = useState<string[]>([]);

	const [grid, setGrid] = useState<GridView>({
		products: [],
		kicker: "Catalog",
		title: "Browse",
	});
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

	const refreshRails = useCallback(async () => {
		setPersonalizing(true);
		try {
			const specs = homeRails(strategyMap.current);
			setRails(
				await Promise.all(specs.map((s) => loadRail(s.strategy, s.label))),
			);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setPersonalizing(false);
		}
	}, []);

	const loadPdpRails = useCallback(async (product: Product) => {
		const map = strategyMap.current;
		const similarLabel = map.similar_items?.label ?? "Similar items";
		const becauseLabel = map.because_viewed?.label ?? "Because you viewed this";
		// Co-occurrence rails (FBT first, also-bought second) — seed-driven, so a
		// cold/co-occurrence-less seed yields empty results and the rail is hidden.
		const [fbtSpec, alsoBoughtSpec] = coBuyRails(map);
		const [fbt, alsoBought, similarItems, because, trending] =
			await Promise.all([
				safeResults(() =>
					recommendStrategy("frequently_bought_together", {
						seed: product.id,
						limit: RAIL_LIMIT,
					}),
				),
				safeResults(() =>
					recommendStrategy("also_bought", {
						seed: product.id,
						limit: RAIL_LIMIT,
					}),
				),
				safeResults(() => similar(product.id, { limit: RAIL_LIMIT })),
				safeResults(() =>
					recommendStrategy("because_viewed", {
						seed: product.id,
						limit: RAIL_LIMIT,
					}),
				),
				safeResults(() => recommendStrategy("trending", { limit: RAIL_LIMIT })),
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
				label: alsoBoughtSpec?.label ?? "Customers who bought this also bought",
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
	}, []);

	const loadGrid = useCallback(async () => {
		setGridLoading(true);
		setError(null);
		try {
			await loadGridInner(
				debouncedQuery,
				activeCategory,
				setCategories,
				setGrid,
			);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setGridLoading(false);
		}
	}, [debouncedQuery, activeCategory]);

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
				setError(errorMessage(err));
				return false;
			}
		},
		[refreshRails, flashToast],
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

			<main className="shop">
				{error !== null && (
					<div className="banner banner--error" role="alert">
						<div className="banner__title">Couldn’t reach the engine</div>
						<div>{error}</div>
						<button
							type="button"
							className="banner__retry"
							onClick={() => {
								void loadGrid();
								void refreshRails();
							}}
						>
							Retry
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
				) : (
					<>
						<RailStack
							rails={rails}
							onPick={onPick}
							personalizing={personalizing}
							signalCount={sessionSignals}
						/>
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

/** Load the grid for the current query/category into the provided setters. */
async function loadGridInner(
	debouncedQuery: string,
	activeCategory: string | null,
	setCategories: (c: string[]) => void,
	setGrid: (g: GridView) => void,
): Promise<void> {
	const trimmed = debouncedQuery.trim();
	if (trimmed !== "") {
		const res = await search(trimmed, { limit: GRID_LIMIT });
		setCategories(deriveCategories(res.results.map((r) => r.product)));
		setGrid({
			products: res.results.map((r) => r.product),
			kicker: "Search results",
			title: `"${trimmed}"`,
		});
		return;
	}
	const res = await browse(
		activeCategory === null
			? { limit: GRID_LIMIT }
			: { limit: GRID_LIMIT, category: activeCategory },
	);
	setCategories(res.categories);
	setGrid({
		products: res.products,
		kicker: "Catalog",
		title: activeCategory ?? "Browse",
	});
}

/** Stable, sorted category list from a product set (used for search views). */
function deriveCategories(products: Product[]): string[] {
	return [...new Set(products.map((p) => p.category))].sort((a, b) =>
		a.localeCompare(b),
	);
}
