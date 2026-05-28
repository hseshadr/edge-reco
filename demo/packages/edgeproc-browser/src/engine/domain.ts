// The engine-owned domain types — the single source of truth for the product
// catalog + search contract shared across the native (Python) and browser tiers.
// These were previously duplicated in the demo's src/api/types.ts; the demo now
// re-exports them from here. The shapes are byte-identical to edge-reco's API
// response models, so the demo components consume the engine output unchanged.

/** One catalog product (a row of products.jsonl). */
export interface Product {
	id: string;
	title: string;
	description: string;
	category: string;
	subcategories: string[];
	tags: string[];
	brand: string;
	price: number | null;
	currency: string;
	popularity_score: number;
	freshness_score: number;
	image_url: string;
	url: string;
	attributes: Record<string, string>;
}

/** The per-result rerank breakdown (why a product scored where it did). */
export interface ScoreComponents {
	popularity: number;
	category_match: number;
	tag_match: number;
	brand_match: number;
	freshness: number;
	repetition_penalty: number;
}

/** A scored product, optionally with its rerank component breakdown. */
export interface SearchResult {
	product: Product;
	score: number;
	score_components: ScoreComponents | null;
}

/** Hybrid-search output (matches the /search route shape). */
export interface SearchResponse {
	results: SearchResult[];
	query: string;
	total: number;
}

/** Session-aware recommendation output (matches the /recommend route shape). */
export interface RecommendResponse {
	results: SearchResult[];
	session_clicks: number;
}

/** Catalog-listing output (matches the /browse route shape). */
export interface BrowseResponse {
	products: Product[];
	total: number;
	categories: string[];
}

/** The interaction kinds the session profile folds forward. */
export type EventType = "click" | "view" | "favorite" | "cart";

/** A single user interaction, folded into the in-tab session profile. */
export interface InteractionEvent {
	event_type: EventType;
	product_id: string;
	timestamp: string;
	metadata?: Record<string, string>;
}
