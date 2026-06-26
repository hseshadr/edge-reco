import { describe, expect, it } from "vitest";
import type { Product, Strategy } from "../api/types";
import {
	coBuyRails,
	homeRails,
	labelFor,
	trendingInCategoryLabel,
} from "./railSelection";

function strat(label: string, policy: Strategy["candidate_policy"]): Strategy {
	return {
		label,
		candidate_policy: policy,
		weights: {
			popularity: 0,
			category: 0,
			tag: 0,
			brand: 0,
			freshness: 0,
			repetition_penalty: 0,
			similarity: 0,
			cooccurrence: 0,
		},
	};
}

const FULL: Record<string, Strategy> = {
	for_you: strat("Recommended for you", "affinity_first"),
	trending: strat("Trending now", "popularity"),
	new_arrivals: strat("New arrivals", "freshness"),
	similar_items: strat("Similar items", "vector_similarity"),
	because_viewed: strat("Because you viewed this", "vector_similarity"),
};

function product(category: string): Product {
	return {
		id: "p1",
		title: "Thing",
		description: "",
		category,
		subcategories: [],
		tags: [],
		brand: "",
		price: null,
		currency: "USD",
		popularity_score: 0,
		freshness_score: 0,
		image_url: "",
		url: "",
		attributes: {},
	};
}

describe("homeRails", () => {
	it("returns For You / Trending / New arrivals in order for a full bundle", () => {
		expect(homeRails(FULL).map((r) => r.strategy)).toEqual([
			"for_you",
			"trending",
			"new_arrivals",
		]);
		expect(homeRails(FULL).map((r) => r.label)).toEqual([
			"Recommended for you",
			"Trending now",
			"New arrivals",
		]);
	});

	it("degrades to the single For You rail when strategies is empty (v1 bundle)", () => {
		expect(homeRails({})).toEqual([
			{ strategy: "for_you", label: "Recommended for you" },
		]);
	});

	it("skips home rails that the bundle does not define", () => {
		const partial: Record<string, Strategy> = {
			for_you: strat("Recommended for you", "affinity_first"),
			trending: strat("Trending now", "popularity"),
		};
		expect(homeRails(partial).map((r) => r.strategy)).toEqual([
			"for_you",
			"trending",
		]);
	});
});

describe("coBuyRails", () => {
	const WITH_COBUY: Record<string, Strategy> = {
		...FULL,
		frequently_bought_together: strat(
			"Frequently bought together",
			"co_occurrence",
		),
		also_bought: strat(
			"Customers who bought this also bought",
			"co_occurrence",
		),
	};

	it("places Frequently bought together first, also-bought second", () => {
		expect(coBuyRails(WITH_COBUY).map((r) => r.strategy)).toEqual([
			"frequently_bought_together",
			"also_bought",
		]);
	});

	it("uses the synced strategy labels when present", () => {
		expect(coBuyRails(WITH_COBUY).map((r) => r.label)).toEqual([
			"Frequently bought together",
			"Customers who bought this also bought",
		]);
	});

	it("falls back to the literal labels when the bundle has no strategy map", () => {
		expect(coBuyRails({})).toEqual([
			{
				strategy: "frequently_bought_together",
				label: "Frequently bought together",
			},
			{
				strategy: "also_bought",
				label: "Customers who bought this also bought",
			},
		]);
	});
});

describe("labelFor", () => {
	it("prefers the synced label", () => {
		expect(labelFor("trending", FULL)).toBe("Trending now");
	});

	it("falls back to a built-in label when the strategy is missing", () => {
		expect(labelFor("similar_items", {})).toBe("Similar items");
	});

	it("falls back to the raw key for an unknown strategy", () => {
		expect(labelFor("mystery", {})).toBe("mystery");
	});
});

describe("trendingInCategoryLabel", () => {
	it("title-cases the category", () => {
		expect(trendingInCategoryLabel(product("home & kitchen"))).toBe(
			"Trending in Home & Kitchen",
		);
	});

	it("falls back to plain Trending now for a blank category", () => {
		expect(trendingInCategoryLabel(product("  "))).toBe("Trending now");
	});

	it("capitalizes each segment of a hyphenated category", () => {
		// Real leaf categories include hyphenated words; each segment should be
		// capitalized, not just the first ("Personal-care" was the old mangle).
		expect(trendingInCategoryLabel(product("health & personal-care"))).toBe(
			"Trending in Health & Personal-Care",
		);
	});

	it("preserves an already-uppercase acronym", () => {
		// An acronym must not be lowercased into "Gps" — keep it as authored.
		expect(trendingInCategoryLabel(product("GPS & Navigation"))).toBe(
			"Trending in GPS & Navigation",
		);
	});
});
