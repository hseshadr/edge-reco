import { describe, expect, it } from "vitest";
import type { Product, SearchResult } from "./domain";
import { DEFAULT_RANKING_CONFIG } from "./rankingConfig";
import { rerank, scoreProduct } from "./reranker";
import { applyInteraction, emptyProfile, type SessionProfile } from "./session";

const WEIGHTS = DEFAULT_RANKING_CONFIG.scoring_weights;

function product(overrides: Partial<Product> & Pick<Product, "id">): Product {
	return {
		id: overrides.id,
		title: overrides.title ?? "",
		description: "",
		category: overrides.category ?? "",
		subcategories: [],
		tags: overrides.tags ?? [],
		brand: overrides.brand ?? "",
		price: null,
		currency: "USD",
		popularity_score: overrides.popularity_score ?? 0,
		freshness_score: overrides.freshness_score ?? 0,
		image_url: "",
		url: "",
		attributes: {},
	};
}

const P1 = product({
	id: "p1",
	category: "Clothing",
	tags: ["men", "golf"],
	brand: "Acme",
	popularity_score: 0.8,
	freshness_score: 0.5,
});
const P2 = product({
	id: "p2",
	category: "Shoes",
	tags: ["run"],
	brand: "Nike",
	popularity_score: 0.6,
	freshness_score: 0.2,
});

function profileFixture(): SessionProfile {
	let profile = emptyProfile();
	profile = applyInteraction(profile, P1, "click");
	profile = applyInteraction(profile, P2, "favorite");
	profile = applyInteraction(profile, P1, "cart");
	return profile;
}

// Reference values from edge-reco reco/scorer.score_product.
describe("scoreProduct (parity vs scorer.score_product)", () => {
	it("breaks down the personalized score by signal", () => {
		const result = scoreProduct(P1, profileFixture());
		expect(result.score).toBeCloseTo(0.2435000000000001, 12);
		const c = result.score_components;
		expect(c?.popularity).toBeCloseTo(0.32, 12);
		expect(c?.category_match).toBeCloseTo(0.07, 12);
		expect(c?.tag_match).toBeCloseTo(0.0255, 12);
		expect(c?.brand_match).toBeCloseTo(0.028, 12);
		expect(c?.freshness).toBeCloseTo(0.05, 12);
		expect(c?.repetition_penalty).toBeCloseTo(0.25, 12);
	});

	it("scores with the empty profile (popularity + freshness only)", () => {
		const result = scoreProduct(P1, emptyProfile());
		expect(result.score).toBeCloseTo(0.37, 12);
		expect(result.score_components?.repetition_penalty).toBe(0);
		expect(result.score_components?.category_match).toBe(0);
	});

	it("averages tag affinity over the product's tags", () => {
		const result = scoreProduct(P2, profileFixture());
		// single tag 'run' affinity 0.1 * tag weight from config = 0.1 * 0.15 = 0.015
		expect(result.score_components?.tag_match).toBeCloseTo(
			0.1 * WEIGHTS.tag,
			12,
		);
	});
});

describe("scoreProduct (weights come from the ranking config)", () => {
	it("default and explicit DEFAULT_RANKING_CONFIG weights agree", () => {
		const implicit = scoreProduct(P1, profileFixture());
		const explicit = scoreProduct(P1, profileFixture(), WEIGHTS);
		expect(explicit.score).toBeCloseTo(implicit.score, 12);
		expect(explicit.score_components).toEqual(implicit.score_components);
	});

	it("honors a retuned config — doubling popularity doubles that signal", () => {
		const retuned = { ...WEIGHTS, popularity: WEIGHTS.popularity * 2 };
		const base = scoreProduct(P1, emptyProfile());
		const doubled = scoreProduct(P1, emptyProfile(), retuned);
		expect(doubled.score_components?.popularity).toBeCloseTo(
			(base.score_components?.popularity ?? 0) * 2,
			12,
		);
	});
});

describe("scoreProduct (Phase-3 co-occurrence term)", () => {
	it("adds weights.cooccurrence * cooc_score and reports the component", () => {
		const weights = { ...WEIGHTS, cooccurrence: 0.7 };
		const base = scoreProduct(P1, emptyProfile(), weights);
		const withCooc = scoreProduct(P1, emptyProfile(), weights, 0, 0.5);
		expect(withCooc.score_components?.cooccurrence).toBeCloseTo(0.7 * 0.5, 12);
		// The cooccurrence term is purely additive over the base score.
		expect(withCooc.score - base.score).toBeCloseTo(0.7 * 0.5, 12);
	});

	it("reports cooccurrence 0 when the weight or score is 0 (Phase-1/2 unchanged)", () => {
		const noWeight = scoreProduct(P1, emptyProfile(), WEIGHTS, 0, 0.9);
		expect(noWeight.score_components?.cooccurrence).toBe(0);
		const noScore = scoreProduct(
			P1,
			emptyProfile(),
			{ ...WEIGHTS, cooccurrence: 0.8 },
			0,
			0,
		);
		expect(noScore.score_components?.cooccurrence).toBe(0);
		// With both similarity and cooccurrence 0, the score equals the Phase-1 formula.
		expect(noScore.score).toBeCloseTo(
			scoreProduct(P1, emptyProfile(), WEIGHTS).score,
			12,
		);
	});
});

describe("rerank", () => {
	it("re-scores and sorts descending by personalized score", () => {
		const input: SearchResult[] = [
			{ product: P2, score: 99, score_components: null },
			{ product: P1, score: 1, score_components: null },
		];
		const out = rerank(input, emptyProfile());
		// P1 popularity 0.8 outscores P2 popularity 0.6 regardless of input order.
		expect(out.map((r) => r.product.id)).toEqual(["p1", "p2"]);
		expect(out[0]?.score_components).not.toBeNull();
	});

	it("keeps input order on ties (stable, matching Python list.sort)", () => {
		const tie = product({ id: "tieA", popularity_score: 0.5 });
		const tie2 = product({ id: "tieB", popularity_score: 0.5 });
		const out = rerank(
			[
				{ product: tie, score: 0, score_components: null },
				{ product: tie2, score: 0, score_components: null },
			],
			emptyProfile(),
		);
		expect(out.map((r) => r.product.id)).toEqual(["tieA", "tieB"]);
	});
});
