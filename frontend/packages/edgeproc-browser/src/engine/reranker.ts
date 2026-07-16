// Session-aware reranker, ported from edge-reco's reco/scorer.py + reco/reranker.py.
// score_product produces a personalized score plus a per-signal breakdown
// (the demo's WhyPopover reads score_components); rerank re-scores a result set
// and sorts it descending. The weights and the formula match scorer.py exactly:
//
//   search score = normalized RRF relevance + personalized score
//   recommendation score = personalized score only
//   personalized score = 0.40*popularity + 0.20*cat + 0.15*tag + 0.10*brand
//                        + 0.10*fresh + sim_weight*similarity
//                        - (0.25 if recently_viewed else 0)
//
// tag_match is the MEAN tag affinity over the product's tags (0 if it has none).
// `similarity` is the per-candidate cosine to a seed product, non-zero only for
// the vector_similarity strategies; it is 0 on every other path, so the formula
// reduces to the original Phase-1 score byte-for-byte.

import type { Product, ScoreComponents, SearchResult } from "./domain";
import { DEFAULT_RANKING_CONFIG, type ScoringWeights } from "./rankingConfig";
import type { SessionProfile } from "./session";

// Search intent is the primary signal. RRF is normalized to [0, 1] before this
// weight is applied, so popularity can refine the fused ranking without erasing it.
const SEARCH_RELEVANCE_WEIGHT = 0.2;

/**
 * Personalized score + signal breakdown for a product (scorer.score_product).
 * `weights` come from the synced bundle's ranking_config.json; they default to
 * DEFAULT_RANKING_CONFIG so call sites on an older bundle keep today's scores.
 *
 * `similarity` is the per-candidate cosine to a seed product, threaded in by the
 * vector_similarity strategies; `cooccurrence` is the per-candidate co-occurrence
 * score to a seed, threaded in by the co_occurrence strategies. Both default to 0
 * so every other path reduces to the original Phase-1 formula byte-for-byte.
 */
export function scoreProduct(
	product: Product,
	profile: SessionProfile,
	weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
	similarity = 0,
	cooccurrence = 0,
	retrieval = 0,
): SearchResult {
	const catMatch = profile.categoryAffinity.get(product.category) ?? 0;

	let tagMatch = 0;
	if (product.tags.length > 0) {
		const total = product.tags.reduce(
			(sum, tag) => sum + (profile.tagAffinity.get(tag) ?? 0),
			0,
		);
		tagMatch = total / product.tags.length;
	}

	const brandMatch = product.brand
		? (profile.brandAffinity.get(product.brand) ?? 0)
		: 0;

	const isRecent = profile.recentlyViewed.includes(product.id);
	const penalty = isRecent ? weights.repetition_penalty : 0;

	const popularity = weights.popularity * product.popularity_score;
	const category = weights.category * catMatch;
	const tag = weights.tag * tagMatch;
	const brand = weights.brand * brandMatch;
	const freshness = weights.freshness * product.freshness_score;
	const similarityTerm = weights.similarity * similarity;
	const cooccurrenceTerm = weights.cooccurrence * cooccurrence;

	const components: ScoreComponents = {
		retrieval,
		popularity,
		category_match: category,
		tag_match: tag,
		brand_match: brand,
		freshness,
		similarity: similarityTerm,
		cooccurrence: cooccurrenceTerm,
		repetition_penalty: penalty,
	};

	return {
		product,
		score:
			retrieval +
			popularity +
			category +
			tag +
			brand +
			freshness +
			similarityTerm +
			cooccurrenceTerm -
			penalty,
		score_components: components,
	};
}

/**
 * Re-score every result against the profile and sort descending by score.
 * Mirrors reranker.rerank: a stable descending sort (ties keep input order),
 * matching Python's list.sort stability so fused-rank ties resolve identically.
 */
export function rerank(
	results: ReadonlyArray<SearchResult>,
	profile: SessionProfile,
	weights: ScoringWeights = DEFAULT_RANKING_CONFIG.scoring_weights,
): ReadonlyArray<SearchResult> {
	const maxRetrieval = Math.max(0, ...results.map((result) => result.score));
	const rescored = results.map((r, index) => ({
		result: scoreProduct(
			r.product,
			profile,
			weights,
			0,
			0,
			maxRetrieval === 0
				? 0
				: SEARCH_RELEVANCE_WEIGHT * (Math.max(0, r.score) / maxRetrieval),
		),
		index,
	}));
	rescored.sort((a, b) => b.result.score - a.result.score || a.index - b.index);
	return rescored.map((entry) => entry.result);
}

/**
 * Re-score every candidate threading its per-id similarity (cosine to a seed),
 * then sort descending — the strategy-aware path mirroring recommend._rerank.
 * `similarity` maps product id → cosine; absent ids score 0, so a strategy whose
 * weights.similarity is 0 reduces to the plain `rerank` result.
 */
export function rerankWithSimilarity(
	results: ReadonlyArray<SearchResult>,
	profile: SessionProfile,
	weights: ScoringWeights,
	similarity: ReadonlyMap<string, number>,
): ReadonlyArray<SearchResult> {
	const rescored = results.map((r, index) => ({
		result: scoreProduct(
			r.product,
			profile,
			weights,
			similarity.get(r.product.id) ?? 0,
		),
		index,
	}));
	rescored.sort((a, b) => b.result.score - a.result.score || a.index - b.index);
	return rescored.map((entry) => entry.result);
}

/**
 * Re-score every candidate threading its per-id co-occurrence score (the seed's
 * neighbour strength), then sort descending — the co_occurrence strategy path
 * mirroring recommend._rerank. `cooccurrence` maps product id → neighbour score;
 * absent ids score 0, so a strategy whose weights.cooccurrence is 0 reduces to the
 * plain `rerank` result. similarity is 0 on this path (co-occurrence carries no
 * cosine), so Phase-1/2 strategies stay byte-identical.
 */
export function rerankWithCooccurrence(
	results: ReadonlyArray<SearchResult>,
	profile: SessionProfile,
	weights: ScoringWeights,
	cooccurrence: ReadonlyMap<string, number>,
): ReadonlyArray<SearchResult> {
	const rescored = results.map((r, index) => ({
		result: scoreProduct(
			r.product,
			profile,
			weights,
			0,
			cooccurrence.get(r.product.id) ?? 0,
		),
		index,
	}));
	rescored.sort((a, b) => b.result.score - a.result.score || a.index - b.index);
	return rescored.map((entry) => entry.result);
}
