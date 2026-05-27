// Session-aware reranker, ported from edge-reco's reco/scorer.py + reco/reranker.py.
// score_product produces a personalized score plus a per-signal breakdown
// (the demo's WhyPopover reads score_components); rerank re-scores a result set
// and sorts it descending. The weights and the formula match scorer.py exactly:
//
//   score = 0.40*popularity + 0.20*cat + 0.15*tag + 0.10*brand + 0.10*fresh
//           - (0.25 if recently_viewed else 0)
//
// tag_match is the MEAN tag affinity over the product's tags (0 if it has none).

import type { Product, ScoreComponents, SearchResult } from "../api/types";
import type { SessionProfile } from "./session";

/** Scoring weights (scorer.py SCORING_WEIGHTS). */
export const SCORING_WEIGHTS = {
	popularity: 0.4,
	category: 0.2,
	tag: 0.15,
	brand: 0.1,
	freshness: 0.1,
	repetitionPenalty: 0.25,
} as const;

/** Personalized score + signal breakdown for a product (scorer.score_product). */
export function scoreProduct(
	product: Product,
	profile: SessionProfile,
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
	const penalty = isRecent ? SCORING_WEIGHTS.repetitionPenalty : 0;

	const popularity = SCORING_WEIGHTS.popularity * product.popularity_score;
	const category = SCORING_WEIGHTS.category * catMatch;
	const tag = SCORING_WEIGHTS.tag * tagMatch;
	const brand = SCORING_WEIGHTS.brand * brandMatch;
	const freshness = SCORING_WEIGHTS.freshness * product.freshness_score;

	const components: ScoreComponents = {
		popularity,
		category_match: category,
		tag_match: tag,
		brand_match: brand,
		freshness,
		repetition_penalty: penalty,
	};

	return {
		product,
		score: popularity + category + tag + brand + freshness - penalty,
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
): ReadonlyArray<SearchResult> {
	const rescored = results.map((r, index) => ({
		result: scoreProduct(r.product, profile),
		index,
	}));
	rescored.sort((a, b) => b.result.score - a.result.score || a.index - b.index);
	return rescored.map((entry) => entry.result);
}
