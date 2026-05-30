import { useCallback, useEffect, useRef, useState } from "react";
import { browse, recommend, search, sendEvent } from "../api/client";
import type { Product, SearchResult } from "../api/types";
import { useDebounced } from "../useDebounced";
import { Footer } from "./Footer";
import { Header } from "./Header";
import { ProductGrid } from "./ProductGrid";
import { RecommendRail } from "./RecommendRail";
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
	const [sessionClicks, setSessionClicks] = useState(0);
	const [personalizing, setPersonalizing] = useState(false);

	const [error, setError] = useState<string | null>(null);
	const [toast, setToast] = useState<string | null>(null);
	const toastTimer = useRef<number | undefined>(undefined);

	const refreshRail = useCallback(async () => {
		setPersonalizing(true);
		try {
			const res = await recommend(RAIL_LIMIT);
			setRailResults(res.results);
			setSessionClicks(res.session_clicks);
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
					title: `“${trimmed}”`,
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

	const flashToast = useCallback((message: string) => {
		setToast(message);
		window.clearTimeout(toastTimer.current);
		toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
	}, []);

	const onPick = useCallback(
		async (product: Product) => {
			try {
				await sendEvent({
					event_type: "click",
					product_id: product.id,
					timestamp: new Date().toISOString(),
				});
				flashToast(`Added “${product.title}” to your taste`);
				await refreshRail();
			} catch (err) {
				setError(errorMessage(err));
			}
		},
		[refreshRail, flashToast],
	);

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
			/>

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
					/>
				</div>

				<RecommendRail
					results={railResults}
					sessionClicks={sessionClicks}
					personalizing={personalizing}
					onPick={onPick}
				/>
			</main>

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
