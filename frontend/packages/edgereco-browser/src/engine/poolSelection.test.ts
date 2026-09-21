import { describe, expect, it } from "vitest";
import type { Product } from "./domain";
import { selectCandidatePool } from "./poolSelection";
import { emptyProfile, type SessionProfile } from "./session";

function product(overrides: Partial<Product> & Pick<Product, "id">): Product {
	return {
		id: overrides.id,
		title: overrides.title ?? `Product ${overrides.id}`,
		description: "",
		category: overrides.category ?? "Electronics",
		subcategories: [],
		tags: overrides.tags ?? [],
		brand: overrides.brand ?? "",
		price: null,
		currency: "USD",
		popularity_score: overrides.popularity_score ?? 0.5,
		freshness_score: 0,
		image_url: "",
		url: "",
		attributes: {},
	};
}

function profileWith(
	overrides: Partial<{
		category: ReadonlyMap<string, number>;
		tag: ReadonlyMap<string, number>;
		brand: ReadonlyMap<string, number>;
	}>,
): SessionProfile {
	return {
		...emptyProfile(),
		categoryAffinity: overrides.category ?? new Map(),
		tagAffinity: overrides.tag ?? new Map(),
		brandAffinity: overrides.brand ?? new Map(),
	};
}

const ids = (results: { product: Product }[]): string[] =>
	results.map((r) => r.product.id);

describe("selectCandidatePool", () => {
	it("returns popularity top-N for an empty profile", () => {
		const catalog = Array.from({ length: 10 }, (_, i) =>
			product({ id: `p${i}`, popularity_score: i / 10 }),
		);
		const pool = selectCandidatePool(catalog, emptyProfile(), 2);
		// n = min(2*5, 10) = 10 → whole catalog, popularity-ordered desc
		expect(ids(pool)).toEqual(
			Array.from({ length: 10 }, (_, i) => `p${9 - i}`),
		);
	});

	it("caps the cold pool at limit*5", () => {
		const catalog = Array.from({ length: 100 }, (_, i) =>
			product({ id: `p${i}`, popularity_score: i / 100 }),
		);
		expect(selectCandidatePool(catalog, emptyProfile(), 2)).toHaveLength(10);
	});

	it("is drawn purely from affinity matches when there are at least `limit`", () => {
		const catalog = Array.from({ length: 50 }, (_, i) =>
			product({ id: `e${i}`, category: "Electronics", popularity_score: 0.9 }),
		);
		for (let i = 0; i < 20; i++) {
			catalog.push(
				product({ id: `c${i}`, category: "Clothing", popularity_score: 0.5 }),
			);
		}
		const profile = profileWith({ category: new Map([["Clothing", 1.0]]) });
		const pool = selectCandidatePool(catalog, profile, 2);
		// >= limit Clothing matches → rail is drawn purely from them; Electronics excluded.
		expect(new Set(pool.map((r) => r.product.category))).toEqual(
			new Set(["Clothing"]),
		);
		expect(ids(pool)).not.toContain("e0");
	});

	it("surfaces an unpopular affinity match deep in the tail", () => {
		const catalog = Array.from({ length: 50 }, (_, i) =>
			product({ id: `e${i}`, category: "Electronics", popularity_score: 0.9 }),
		);
		for (let i = 0; i < 5; i++) {
			catalog.push(
				product({ id: `c${i}`, category: "Clothing", popularity_score: 0.01 }),
			);
		}
		const profile = profileWith({ category: new Map([["Clothing", 1.0]]) });
		expect(ids(selectCandidatePool(catalog, profile, 2))).toContain("c0");
	});

	it("backfills popularity when there are fewer than `limit` matches", () => {
		const catalog = Array.from({ length: 50 }, (_, i) =>
			product({
				id: `e${i}`,
				category: "Electronics",
				popularity_score: (i + 1) / 100,
			}),
		);
		catalog.push(
			product({ id: "niche", category: "Clothing", popularity_score: 0.01 }),
		);
		const profile = profileWith({ category: new Map([["Clothing", 1.0]]) });
		const result = ids(selectCandidatePool(catalog, profile, 5));
		expect(result).toContain("niche"); // the lone match
		expect(result).toContain("e49"); // ...plus popularity backfill
	});

	it("dedupes an item that is both popular and an affinity match", () => {
		const catalog = [
			product({ id: "top", category: "Clothing", popularity_score: 1.0 }),
			...Array.from({ length: 5 }, (_, i) =>
				product({
					id: `e${i}`,
					category: "Electronics",
					popularity_score: 0.5,
				}),
			),
		];
		const profile = profileWith({ category: new Map([["Clothing", 1.0]]) });
		const occurrences = ids(selectCandidatePool(catalog, profile, 2)).filter(
			(id) => id === "top",
		);
		expect(occurrences).toHaveLength(1);
	});

	it("collapses to popularity-only when nothing matches the profile", () => {
		const catalog = Array.from({ length: 10 }, (_, i) =>
			product({
				id: `e${i}`,
				category: "Electronics",
				popularity_score: i / 10,
			}),
		);
		const profile = profileWith({ category: new Map([["Clothing", 1.0]]) });
		expect(ids(selectCandidatePool(catalog, profile, 2))).toEqual(
			Array.from({ length: 10 }, (_, i) => `e${9 - i}`),
		);
	});
});
