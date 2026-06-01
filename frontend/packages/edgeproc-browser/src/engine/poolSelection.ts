// Candidate-pool selection for recommend(), ported from edge-reco's reco/pool.py.
// Cold (empty profile): popularity top-N — the legacy behavior. Warm: the union of
// popularity top-N and an affinity top-M, deduped by id, so low-popularity items
// matching the session's taste become candidates and can surface after rerank.
// The scoring formula (reranker.ts) is unchanged; only candidate *selection*
// broadens. Logic matches pool.py exactly.

import type { Product, SearchResult } from "./domain";
import { SCORING_WEIGHTS } from "./reranker";
import type { SessionProfile } from "./session";

/** Personalization-only score (category + tag + brand affinity), no popularity. */
function affinityScore(product: Product, profile: SessionProfile): number {
	const cat = profile.categoryAffinity.get(product.category) ?? 0;
	let tag = 0;
	if (product.tags.length > 0) {
		const total = product.tags.reduce(
			(sum, t) => sum + (profile.tagAffinity.get(t) ?? 0),
			0,
		);
		tag = total / product.tags.length;
	}
	const brand = product.brand
		? (profile.brandAffinity.get(product.brand) ?? 0)
		: 0;
	const w = SCORING_WEIGHTS;
	return w.category * cat + w.tag * tag + w.brand * brand;
}

/** True once the session has folded in any interaction signal. */
function hasAffinity(profile: SessionProfile): boolean {
	return (
		profile.categoryAffinity.size > 0 ||
		profile.tagAffinity.size > 0 ||
		profile.brandAffinity.size > 0
	);
}

function popularityTop(catalog: ReadonlyArray<Product>, n: number): Product[] {
	return [...catalog]
		.sort((a, b) => b.popularity_score - a.popularity_score)
		.slice(0, n);
}

function affinityTop(
	catalog: ReadonlyArray<Product>,
	profile: SessionProfile,
	m: number,
): Product[] {
	return catalog
		.map((product) => ({ product, score: affinityScore(product, profile) }))
		.filter((entry) => entry.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, m)
		.map((entry) => entry.product);
}

function dedupeById(products: ReadonlyArray<Product>): Product[] {
	const seen = new Set<string>();
	const unique: Product[] = [];
	for (const product of products) {
		if (!seen.has(product.id)) {
			seen.add(product.id);
			unique.push(product);
		}
	}
	return unique;
}

/** Eligible products for rerank: popularity top-N, plus affinity top-M when warm. */
export function selectCandidatePool(
	catalog: ReadonlyArray<Product>,
	profile: SessionProfile,
	limit: number,
): SearchResult[] {
	const size = Math.min(limit * 5, catalog.length);
	let pool = popularityTop(catalog, size);
	if (hasAffinity(profile)) {
		pool = dedupeById([...pool, ...affinityTop(catalog, profile, size)]);
	}
	return pool.map((product) => ({
		product,
		score: product.popularity_score,
		score_components: null,
	}));
}
