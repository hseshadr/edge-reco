import { describe, expect, it } from "vitest";
import { type RankedHit, reciprocalRankFusion } from "./rerank";

function hits(ids: ReadonlyArray<string>): ReadonlyArray<RankedHit> {
	// RRF ignores the raw score; rank (position) is all that matters.
	return ids.map((id, i) => ({ id, score: 1 - i * 0.01 }));
}

describe("reciprocalRankFusion", () => {
	it("matches the hand-computed RRF score for overlapping lists (k=60)", () => {
		const keyword = hits(["a", "b", "c"]);
		const vector = hits(["b", "a", "d"]);
		const fused = reciprocalRankFusion(keyword, vector);

		// rrf(doc) = sum 1/(60 + rank + 1) over each list containing doc.
		const r = (rank: number): number => 1 / (60 + rank + 1);
		const expected = new Map<string, number>([
			["a", r(0) + r(1)],
			["b", r(1) + r(0)],
			["c", r(2)],
			["d", r(2)],
		]);
		// a and b tie (r(0)+r(1)); c and d tie (r(2)). a/b rank above c/d.
		expect(
			fused
				.map((h) => h.id)
				.slice(0, 2)
				.sort(),
		).toEqual(["a", "b"]);
		expect(
			fused
				.map((h) => h.id)
				.slice(2)
				.sort(),
		).toEqual(["c", "d"]);
		for (const hit of fused) {
			expect(hit.score).toBeCloseTo(expected.get(hit.id) ?? 0, 12);
		}
	});

	it("a single ranked list is returned in the same order (rank-monotone)", () => {
		const only = hits(["x", "y", "z"]);
		const fused = reciprocalRankFusion(only, []);
		expect(fused.map((h) => h.id)).toEqual(["x", "y", "z"]);
		expect(fused[0]?.score).toBeGreaterThan(fused[1]?.score ?? 0);
		expect(fused[1]?.score).toBeGreaterThan(fused[2]?.score ?? 0);
	});

	it("honors a custom k constant", () => {
		const fused = reciprocalRankFusion(hits(["a"]), [], 10);
		expect(fused[0]?.score).toBeCloseTo(1 / (10 + 0 + 1), 12);
	});
});
