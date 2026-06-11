import { useCallback, useEffect, useRef, useState } from "react";
import { resolveBundleBaseUrl } from "../api/bundleUrl";
import { browse, catalogInfo, recommend, search } from "../api/client";
import type { EventType, Product, SearchResult } from "../api/types";
import { startMetricsObservers } from "../metrics/observe";
import { record } from "../metrics/store";
import { emitInteraction } from "../signals/emit";
import { useDwellViews } from "../signals/useDwellViews";
import { useDebounced } from "../useDebounced";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { MetricsStrip } from "./MetricsStrip";
import { ProductGrid } from "./ProductGrid";
import { RecommendRail } from "./RecommendRail";
import { SyncBadge } from "./SyncBadge";
import { Toast } from "./Toast";

const RAIL_LIMIT = 8;
const GRID_LIMIT = 24; // frozen: storefront grid page size
const TOAST_MS = 2200;

interface GridView {
	products: Product[];
	kicker: string;
	title: string;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unexpected error";
}

/**
 * The Nimbus storefront. Mounted only once the engine has bootstrapped, so its
 * data effects run against a ready in-tab engine — there is no network here:
 * search/recommend/browse run in-tab, and a click folds into the in-tab session
 * profile so the rail re-ranks immediately (the demo's hero loop).
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

	const [railResults, setRailResults] = useState<SearchResult[]>([]);
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

	const refreshRail = useCallback(async () => {
		setPersonalizing(true);
		try {
			const res = await recommend(RAIL_LIMIT);
			setRailResults(res.results);
		} catch (err) {
			setError(errorMessage(err));
		} finally {
			setPersonalizing(false);
		}
	}, []);

	const loadGrid = useCallback(async () => {
		setGridLoading(true);
		setError(null);
		try {
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
		void refreshRail();
	}, [refreshRail]);

	useEffect(() => {
		return () => window.clearTimeout(toastTimer.current);
	}, []);

	// Live metrics: Storefront mounts only once the engine is ready, so now() is a
	// sound `readyAt` for the post-sync backend-call observer. We also record the
	// catalog size here (the engine's ntotal) — honest because the engine is ready.
	useEffect(() => {
		const stop = startMetricsObservers({
			readyAt: performance.now(),
			// The ORIGIN of the resolved bundle URL (resolution handles the
			// app-relative GitHub Pages form; classify compares origins).
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
				await refreshRail();
				return true;
			} catch (err) {
				setError(errorMessage(err));
				return false;
			}
		},
		[refreshRail, flashToast],
	);

	const onPick = useCallback(
		async (product: Product) => {
			await emitExplicit("click", product);
		},
		[emitExplicit],
	);

	const onFavorite = useCallback(
		async (product: Product) => {
			const wasFavorited = favoritedIds.has(product.id);
			setFavoritedIds((prev) => {
				const next = new Set(prev);
				if (wasFavorited) next.delete(product.id);
				else next.add(product.id);
				return next;
			});
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
				.then((outcome) => (outcome.emitted ? refreshRail() : undefined))
				.catch(() => undefined);
		},
		[refreshRail],
	);
	const registerDwell = useDwellViews(onDwell);

	const onSelectCategory = useCallback((category: string | null) => {
		setQuery("");
		setActiveCategory(category);
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

			<main className="layout">
				<div>
					{error !== null && (
						<div className="banner banner--error" role="alert">
							<div className="banner__title">Couldn’t reach the engine</div>
							<div>{error}</div>
							<button
								type="button"
								className="banner__retry"
								onClick={() => {
									void loadGrid();
									void refreshRail();
								}}
							>
								Retry
							</button>
						</div>
					)}

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
				</div>

				<RecommendRail
					results={railResults}
					sessionSignals={sessionSignals}
					personalizing={personalizing}
					onPick={onPick}
				/>
			</main>

			<SyncBadge />

			<Footer />

			<Toast message={toast} />
		</>
	);
}

/** Stable, sorted category list from a product set (used for search views). */
function deriveCategories(products: Product[]): string[] {
	return [...new Set(products.map((p) => p.category))].sort((a, b) =>
		a.localeCompare(b),
	);
}
