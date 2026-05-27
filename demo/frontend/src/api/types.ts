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

export interface ScoreComponents {
	popularity: number;
	category_match: number;
	tag_match: number;
	brand_match: number;
	freshness: number;
	repetition_penalty: number;
}

export interface SearchResult {
	product: Product;
	score: number;
	score_components: ScoreComponents | null;
}

export interface SearchResponse {
	results: SearchResult[];
	query: string;
	total: number;
}

export interface RecommendResponse {
	results: SearchResult[];
	session_clicks: number;
}

export type EventType = "click" | "view" | "favorite" | "cart";

export interface InteractionEvent {
	event_type: EventType;
	product_id: string;
	timestamp: string;
	metadata?: Record<string, string>;
}
