import { describe, expect, it } from "vitest";
import type { Product } from "../api/types";
import { KeywordSearcher, productTokens, tokenize } from "./keyword";

// Reference values computed against rank_bm25.BM25Okapi (defaults k1=1.5, b=0.75,
// epsilon=0.25) over this corpus, where "shirt" appears in 4/5 docs and so gets a
// negative raw IDF floored to epsilon*average_idf — exercising the epsilon path.
//
//   a: shirt polo red       c: shirt cotton men     e: shoes women
//   b: shirt golf blue      d: shirt running
const CORPUS: ReadonlyArray<ReadonlyArray<string>> = [
	["shirt", "polo", "red"],
	["shirt", "golf", "blue"],
	["shirt", "cotton", "men"],
	["shirt", "running"],
	["shoes", "women"],
];
const IDS = ["a", "b", "c", "d", "e"];

describe("tokenize", () => {
	it("lowercases and splits on whitespace", () => {
		expect(tokenize("  Polo   SHIRT Men ")).toEqual(["polo", "shirt", "men"]);
	});
	it("returns [] for blank input", () => {
		expect(tokenize("   ")).toEqual([]);
		expect(tokenize("")).toEqual([]);
	});
});

describe("productTokens", () => {
	it("projects title + category + tags + brand, lowercased", () => {
		const product = {
			id: "p1",
			title: "Polo Shirt",
			description: "ignored",
			category: "Clothing",
			subcategories: ["ignored"],
			tags: ["men", "golf"],
			brand: "Acme",
			price: null,
			currency: "USD",
			popularity_score: 0,
			freshness_score: 0,
			image_url: "",
			url: "",
			attributes: {},
		} satisfies Product;
		expect(productTokens(product)).toEqual([
			"polo",
			"shirt",
			"clothing",
			"men",
			"golf",
			"acme",
		]);
	});
});

describe("KeywordSearcher BM25 parity (hand-checked vs rank_bm25.BM25Okapi)", () => {
	const searcher = KeywordSearcher.fromCorpus(CORPUS, IDS);

	it("scores a single common term with the epsilon-floored IDF", () => {
		// "shirt" floored IDF path; d (len 2) outranks the len-3 docs.
		const hits = searcher.search("shirt");
		expect(hits.map((h) => h.id)).toEqual(["d", "a", "b", "c"]);
		expect(hits[0]?.score).toBeCloseTo(0.24518385841520043, 12);
		expect(hits[1]?.score).toBeCloseTo(0.20549582377964642, 12);
		expect(hits[2]?.score).toBeCloseTo(0.20549582377964642, 12);
		expect(hits[3]?.score).toBeCloseTo(0.20549582377964642, 12);
	});

	it("scores a rare term with full IDF", () => {
		const hits = searcher.search("polo");
		expect(hits.map((h) => h.id)).toEqual(["a"]);
		expect(hits[0]?.score).toBeCloseTo(1.0274791188982322, 12);
	});

	it("sums per-term contributions for a multi-term query", () => {
		const hits = searcher.search("shirt polo");
		expect(hits.map((h) => h.id)).toEqual(["a", "d", "b", "c"]);
		expect(hits[0]?.score).toBeCloseTo(1.2329749426778787, 12);
		expect(hits[1]?.score).toBeCloseTo(0.24518385841520043, 12);
	});

	it("breaks ties by ascending corpus index", () => {
		const hits = searcher.search("men shirt");
		expect(hits.map((h) => h.id)).toEqual(["c", "d", "a", "b"]);
		expect(hits[0]?.score).toBeCloseTo(1.2329749426778787, 12);
	});

	it("returns only strictly-positive scores", () => {
		expect(searcher.search("zzz")).toEqual([]);
	});

	it("returns [] for a blank query", () => {
		expect(searcher.search("   ")).toEqual([]);
	});

	it("honors the top-k cap", () => {
		expect(searcher.search("shirt", 2).map((h) => h.id)).toEqual(["d", "a"]);
	});

	it("handles an empty corpus", () => {
		expect(KeywordSearcher.fromCorpus([], []).search("anything")).toEqual([]);
	});
});
