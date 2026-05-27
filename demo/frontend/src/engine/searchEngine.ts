// Browser search engine: the full in-browser equivalent of edge-reco's /search
// and /recommend routes (src/edgereco/api/routes/{search,recommend}.py), driven
// from a query STRING. Pipeline, matching search.py exactly:
//
//   q -> embed(q) [embedder.ts]            (transformers.js, parity-verified)
//     -> BM25 top-k [keyword.ts]  +  vector cosine top-k [vectorIndex.ts]
//     -> RRF fuse [rerank.ts]              (k = max(limit*3, 30))
//     -> session rerank [reranker.ts]      (always runs; empty profile = pop+fresh)
//     -> optional category filter -> slice to limit
//
// `total` is the pre-category-filter fused count (search.py total_pre_filter).
// recommend() mirrors recommend.py: a popularity pool of min(limit*5, N) reranked
// by the session profile. browse() is the catalog-listing path over products.jsonl.
//
// The C2b vector-only parity path is preserved as searchVector(queryVec).

import type {
	BrowseResponse,
	Product,
	RecommendResponse,
	SearchResponse,
	SearchResult,
} from "../api/types";
import type { Embedder } from "./embedder";
import { KeywordSearcher } from "./keyword";
import { reciprocalRankFusion } from "./rerank";
import { rerank } from "./reranker";
import { emptyProfile, type SessionProfile } from "./session";
import {
	loadVectorIndex,
	type VectorIndex,
	type VectorIndexFiles,
} from "./vectorIndex";

const DEFAULT_LIMIT = 10;

/** Options for a search; `limit` caps results, `category` filters post-rerank. */
export interface SearchOptions {
	readonly limit?: number;
	readonly category?: string;
	readonly profile?: SessionProfile;
}

/** Options for a recommend call. */
export interface RecommendOptions {
	readonly limit?: number;
	readonly profile?: SessionProfile;
}

/** Options for a catalog browse. */
export interface BrowseOptions {
	readonly limit?: number;
	readonly category?: string;
}

/** The browser-side search surface over the synced bundle. */
export interface SearchEngine {
	readonly ntotal: number;
	/** Full hybrid search from a query string (matches /search). */
	search(query: string, opts?: SearchOptions): Promise<SearchResponse>;
	/** Session-aware recommendations over the popularity pool (matches /recommend). */
	recommend(opts?: RecommendOptions): RecommendResponse;
	/** Catalog listing path (browse/category pages). */
	browse(opts?: BrowseOptions): BrowseResponse;
	/** Vector-only cosine top-k from a query vector (C2b parity path). */
	searchVector(queryVec: Float32Array, opts?: SearchOptions): SearchResponse;
}

function hydrateFused(
	index: VectorIndex,
	fused: ReadonlyArray<{ readonly id: string; readonly score: number }>,
): SearchResult[] {
	const results: SearchResult[] = [];
	for (const { id, score } of fused) {
		const product = index.product(id);
		if (product !== undefined) {
			results.push({ product, score, score_components: null });
		}
	}
	return results;
}

class HybridSearchEngine implements SearchEngine {
	readonly #index: VectorIndex;
	readonly #keyword: KeywordSearcher;
	readonly #embedder: Embedder;
	readonly #catalog: ReadonlyArray<Product>;

	public constructor(
		index: VectorIndex,
		keyword: KeywordSearcher,
		embedder: Embedder,
	) {
		this.#index = index;
		this.#keyword = keyword;
		this.#embedder = embedder;
		this.#catalog = index.products();
	}

	public get ntotal(): number {
		return this.#index.ntotal;
	}

	public async search(
		query: string,
		opts?: SearchOptions,
	): Promise<SearchResponse> {
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		if (query.trim().length === 0) {
			return { results: [], query: "", total: 0 };
		}
		// Candidate width matches the backend: k = max(limit*3, 30).
		const k = Math.max(limit * 3, 30);
		const keywordHits = this.#keyword.search(query, k);
		const queryVec = await this.#embedder.embed(query);
		const vectorHits = this.#index.search(queryVec, k);
		const fused = reciprocalRankFusion(keywordHits, vectorHits);

		const fusedResults = hydrateFused(this.#index, fused);
		const totalPreFilter = fusedResults.length;

		const profile = opts?.profile ?? emptyProfile();
		let reranked = rerank(fusedResults, profile);
		if (opts?.category !== undefined) {
			reranked = reranked.filter((r) => r.product.category === opts.category);
		}
		return {
			results: [...reranked.slice(0, limit)],
			query,
			total: totalPreFilter,
		};
	}

	public recommend(opts?: RecommendOptions): RecommendResponse {
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		const profile = opts?.profile ?? emptyProfile();
		const poolSize = Math.min(limit * 5, this.#catalog.length);
		const pool = [...this.#catalog]
			.sort((a, b) => b.popularity_score - a.popularity_score)
			.slice(0, poolSize);
		const candidates: SearchResult[] = pool.map((product) => ({
			product,
			score: product.popularity_score,
			score_components: null,
		}));
		const ranked = rerank(candidates, profile);
		return {
			results: [...ranked.slice(0, limit)],
			session_clicks: profile.clickCount,
		};
	}

	public browse(opts?: BrowseOptions): BrowseResponse {
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		const filtered =
			opts?.category !== undefined
				? this.#catalog.filter((p) => p.category === opts.category)
				: this.#catalog;
		const categories = [
			...new Set(this.#catalog.map((p) => p.category)),
		].sort();
		return {
			products: filtered.slice(0, limit),
			total: filtered.length,
			categories,
		};
	}

	public searchVector(
		queryVec: Float32Array,
		opts?: SearchOptions,
	): SearchResponse {
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		const k = Math.max(limit * 3, 30);
		const hits = this.#index.search(queryVec, k);
		const cosineById = new Map(hits.map((h) => [h.id, h.score]));
		// RRF over the single vector ranking is rank-monotone: preserves cosine
		// order. Report cosine on the result (what VectorSearcher exposes).
		const fused = reciprocalRankFusion(hits, []);
		const results: SearchResult[] = [];
		for (const { id } of fused) {
			const product = this.#index.product(id);
			if (product !== undefined) {
				results.push({
					product,
					score: cosineById.get(id) ?? 0,
					score_components: null,
				});
			}
		}
		const sliced = results.slice(0, limit);
		return { results: sliced, query: "", total: sliced.length };
	}
}

/** Parse the synced files and return a query-ready hybrid SearchEngine. */
export async function createSearchEngine(
	files: VectorIndexFiles,
	embedder: Embedder,
): Promise<SearchEngine> {
	const index = await loadVectorIndex(files);
	const keyword = KeywordSearcher.fromProducts(index.products());
	return new HybridSearchEngine(index, keyword, embedder);
}
