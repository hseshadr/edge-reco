// TS port of edgeproc.localvec.fusion.reciprocal_rank_fusion (the shared lego the
// Python tier consumes via edge-reco's search/hybrid.py). The formula and the
// default k=60 constant match the Python implementation byte-for-byte so a fused
// ranking computed here equals the backend's.

/** One ranked hit; RRF uses only its rank (position), not the raw score. */
export interface RankedHit {
	readonly id: string;
	readonly score: number;
}

const DEFAULT_K = 60;

/**
 * rrf_score(doc) = sum(1 / (k + rank_i + 1)) over each list containing doc,
 * returned sorted by descending fused score. Mirrors the Python reference; with
 * a single ranked list it reduces to a rank-monotone re-scoring of that list.
 */
export function reciprocalRankFusion(
	keywordResults: ReadonlyArray<RankedHit>,
	vectorResults: ReadonlyArray<RankedHit>,
	k: number = DEFAULT_K,
): ReadonlyArray<RankedHit> {
	const scores = new Map<string, number>();
	const accumulate = (list: ReadonlyArray<RankedHit>): void => {
		list.forEach((hit, rank) => {
			scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (k + rank + 1));
		});
	};
	accumulate(keywordResults);
	accumulate(vectorResults);
	return [...scores.entries()]
		.map(([id, score]) => ({ id, score }))
		.sort((a, b) => b.score - a.score);
}
