// Browser search engine: ties the synced bundle (via loadVectorIndex) and RRF
// (rerank.ts) into a SearchResponse-shaped result that mirrors edge-reco's
// /search route (src/edgereco/api/routes/search.py).
//
// Scope (C2b): vector retrieval + RRF over the vector ranking only. The backend
// route fuses a BM25 keyword ranking with the vector ranking and then applies a
// session reranker. Both of those need inputs C2b does not have yet:
//   - BM25 needs the query STRING and a ported BM25Okapi corpus; C2b's search
//     takes a query VECTOR (query embedding lands in C3), so keyword retrieval is
//     structurally absent here, not merely deferred for size.
//   - the session reranker needs a SessionProfile and per-product affinities.
// So `score` carries the cosine similarity and `score_components` is null until
// C3 wires the full hybrid + reranker. RRF is still applied (over the single
// vector list) so the fusion seam exists and matches the backend code path; over
// one ranked list it is rank-monotone, preserving the cosine top-k ordering.

import type { SearchResponse, SearchResult } from "../api/types";
import { reciprocalRankFusion } from "./rerank";
import {
	loadVectorIndex,
	type VectorIndex,
	type VectorIndexFiles,
} from "./vectorIndex";

const DEFAULT_LIMIT = 10;

/** Options for a vector search; `limit` caps the returned results. */
export interface SearchOptions {
	readonly limit?: number;
}

/** The browser-side search surface over the synced bundle. */
export interface SearchEngine {
	readonly ntotal: number;
	search(queryVec: Float32Array, opts?: SearchOptions): SearchResponse;
}

function hydrate(
	index: VectorIndex,
	rankedIds: ReadonlyArray<string>,
	scoreById: ReadonlyMap<string, number>,
): ReadonlyArray<SearchResult> {
	const results: SearchResult[] = [];
	for (const id of rankedIds) {
		const product = index.product(id);
		if (product === undefined) {
			continue;
		}
		results.push({
			product,
			score: scoreById.get(id) ?? 0,
			// no session reranker in C2b -> no per-signal breakdown yet.
			score_components: null,
		});
	}
	return results;
}

class VectorSearchEngine implements SearchEngine {
	readonly #index: VectorIndex;

	public constructor(index: VectorIndex) {
		this.#index = index;
	}

	public get ntotal(): number {
		return this.#index.ntotal;
	}

	public search(queryVec: Float32Array, opts?: SearchOptions): SearchResponse {
		const limit = opts?.limit ?? DEFAULT_LIMIT;
		// Match the backend's candidate width: k = max(limit*3, 30).
		const k = Math.max(limit * 3, 30);
		const hits = this.#index.search(queryVec, k);
		const cosineById = new Map(hits.map((h) => [h.id, h.score]));
		// RRF over the single vector ranking (rank-monotone): keeps the cosine
		// top-k order. The fused score is discarded — we report cosine on the
		// result, which is what the Python VectorSearcher exposes pre-fusion.
		const fused = reciprocalRankFusion(hits, []);
		const results = hydrate(
			this.#index,
			fused.map((h) => h.id),
			cosineById,
		).slice(0, limit);
		return {
			results,
			query: "",
			total: results.length,
		};
	}
}

/** Parse the synced files and return a query-ready SearchEngine. */
export async function createSearchEngine(
	files: VectorIndexFiles,
): Promise<SearchEngine> {
	return new VectorSearchEngine(await loadVectorIndex(files));
}
