import { describe, it, expect } from "vitest";
import { rerank, SCORING_WEIGHTS } from "./reranker.js";
import type { CatalogItem, ProfileSnapshot } from "../types.js";

const emptyProfile: ProfileSnapshot = {
  categoryAffinity: {},
  tagAffinity: {},
  recentlyViewed: [],
  sessionClickCount: 0,
};

const makeItem = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "item_1",
  title: "Thing",
  category: "running",
  tags: ["lightweight"],
  popularityScore: 0.5,
  freshnessScore: 0.5,
  ...overrides,
});

describe("rerank — formula", () => {
  it("empty profile: score equals 0.5*pop + 0.1*freshness", () => {
    const item = makeItem({
      popularityScore: 0.8,
      freshnessScore: 0.4,
      tags: [],
    });
    const { items } = rerank([item], emptyProfile);
    const expected = 0.5 * 0.8 + 0.1 * 0.4;
    expect(items[0]!.finalScore).toBeCloseTo(expected, 10);
  });

  it("full category affinity contributes 0.25", () => {
    const item = makeItem({
      popularityScore: 0,
      freshnessScore: 0,
      tags: [],
    });
    const profile: ProfileSnapshot = {
      ...emptyProfile,
      categoryAffinity: { running: 1.0 },
    };
    const { items } = rerank([item], profile);
    expect(items[0]!.finalScore).toBeCloseTo(0.25, 10);
  });

  it("tag match equals mean(tag affinities) scaled by 0.15", () => {
    const item = makeItem({
      popularityScore: 0,
      freshnessScore: 0,
      tags: ["a", "b"],
    });
    const profile: ProfileSnapshot = {
      ...emptyProfile,
      tagAffinity: { a: 1.0, b: 0.0 },
    };
    const { items } = rerank([item], profile);
    expect(items[0]!.finalScore).toBeCloseTo(0.075, 10);
  });

  it("item with empty tags gets zero tag-match contribution", () => {
    const item = makeItem({
      popularityScore: 0,
      freshnessScore: 0,
      tags: [],
    });
    const profile: ProfileSnapshot = {
      ...emptyProfile,
      tagAffinity: { anything: 1.0 },
    };
    const { items } = rerank([item], profile);
    expect(items[0]!.finalScore).toBeCloseTo(0, 10);
  });

  it("repetition penalty subtracts 0.3 when item.id is in recentlyViewed", () => {
    const item = makeItem({
      id: "seen",
      popularityScore: 1,
      freshnessScore: 0,
      tags: [],
    });
    const profile: ProfileSnapshot = {
      ...emptyProfile,
      recentlyViewed: ["seen"],
    };
    const { items } = rerank([item], profile);
    expect(items[0]!.finalScore).toBeCloseTo(0.2, 10);
  });
});

describe("rerank — sorting", () => {
  it("sorts items descending by finalScore", () => {
    const items = [
      makeItem({ id: "low", popularityScore: 0.1, tags: [] }),
      makeItem({ id: "high", popularityScore: 0.9, tags: [] }),
      makeItem({ id: "mid", popularityScore: 0.5, tags: [] }),
    ];
    const { items: ranked } = rerank(items, emptyProfile);
    expect(ranked.map((i) => i.id)).toEqual(["high", "mid", "low"]);
  });
});

describe("rerank — rawItems passthrough", () => {
  it("rawItems preserves input order and values", () => {
    const items = [
      makeItem({ id: "a", popularityScore: 0.1 }),
      makeItem({ id: "b", popularityScore: 0.9 }),
    ];
    const { rawItems } = rerank(items, emptyProfile);
    expect(rawItems.map((i) => i.id)).toEqual(["a", "b"]);
  });
});

describe("rerank — score breakdown", () => {
  it("breakdown components sum to finalScore", () => {
    const item = makeItem({
      popularityScore: 0.7,
      freshnessScore: 0.4,
      tags: ["lightweight"],
    });
    const profile: ProfileSnapshot = {
      ...emptyProfile,
      categoryAffinity: { running: 0.6 },
      tagAffinity: { lightweight: 0.8 },
      recentlyViewed: [item.id],
    };
    const { items } = rerank([item], profile);
    const bd = items[0]!.scoreBreakdown;
    const summed =
      bd.popularity +
      bd.categoryMatch +
      bd.tagMatch +
      bd.freshness -
      bd.repetitionPenalty;
    expect(items[0]!.finalScore).toBeCloseTo(summed, 10);
  });
});

describe("rerank — weights", () => {
  it("exposes the weights used by the formula", () => {
    expect(SCORING_WEIGHTS.popularity).toBe(0.5);
    expect(SCORING_WEIGHTS.category).toBe(0.25);
    expect(SCORING_WEIGHTS.tag).toBe(0.15);
    expect(SCORING_WEIGHTS.freshness).toBe(0.1);
    expect(SCORING_WEIGHTS.repetitionPenalty).toBe(0.3);
  });
});
