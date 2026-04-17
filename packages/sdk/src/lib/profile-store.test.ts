import { afterEach, describe, expect, it } from "vitest";
import type { CatalogItem } from "../types.js";
import { type ProfileStore, SCORING_CONSTANTS, createProfileStore } from "./profile-store.js";

const stores: ProfileStore[] = [];

async function makeStore(): Promise<ProfileStore> {
  const store = await createProfileStore();
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const s of stores) {
    s.close();
  }
  stores.length = 0;
  indexedDB.deleteDatabase("edgereco");
});

const makeItem = (overrides: Partial<CatalogItem> = {}): CatalogItem => ({
  id: "item_1",
  title: "Thing",
  category: "running",
  tags: ["lightweight", "waterproof"],
  popularityScore: 0.5,
  freshnessScore: 0.5,
  ...overrides,
});

describe("profileStore — initial state", () => {
  it("snapshot returns zeroed profile before first mutation", async () => {
    const store = await makeStore();
    const snap = store.snapshot();
    expect(snap.categoryAffinity).toEqual({});
    expect(snap.tagAffinity).toEqual({});
    expect(snap.recentlyViewed).toEqual([]);
    expect(snap.sessionClickCount).toBe(0);
  });
});

describe("profileStore.applyClick", () => {
  it("bumps categoryAffinity by the click weight", async () => {
    const store = await makeStore();
    await store.applyClick(makeItem({ category: "running" }));
    expect(store.snapshot().categoryAffinity.running).toBeCloseTo(
      SCORING_CONSTANTS.clickCategoryBump,
      10,
    );
  });

  it("caps categoryAffinity at 1.0", async () => {
    const store = await makeStore();
    for (let i = 0; i < 20; i++) {
      await store.applyClick(makeItem({ id: `i_${i}`, category: "running" }));
    }
    expect(store.snapshot().categoryAffinity.running).toBe(1.0);
  });

  it("bumps tag affinities by the tag weight", async () => {
    const store = await makeStore();
    await store.applyClick(makeItem({ tags: ["lightweight", "waterproof"] }));
    expect(store.snapshot().tagAffinity.lightweight).toBeCloseTo(
      SCORING_CONSTANTS.clickTagBump,
      10,
    );
    expect(store.snapshot().tagAffinity.waterproof).toBeCloseTo(SCORING_CONSTANTS.clickTagBump, 10);
  });

  it("prepends clicked item to recentlyViewed", async () => {
    const store = await makeStore();
    await store.applyClick(makeItem({ id: "a" }));
    await store.applyClick(makeItem({ id: "b" }));
    expect(store.snapshot().recentlyViewed).toEqual(["b", "a"]);
  });

  it("caps recentlyViewed at 20 entries", async () => {
    const store = await makeStore();
    for (let i = 0; i < 25; i++) {
      await store.applyClick(makeItem({ id: `i_${i}` }));
    }
    expect(store.snapshot().recentlyViewed.length).toBe(20);
    expect(store.snapshot().recentlyViewed[0]).toBe("i_24");
  });

  it("increments sessionClickCount", async () => {
    const store = await makeStore();
    await store.applyClick(makeItem({ id: "a" }));
    await store.applyClick(makeItem({ id: "b" }));
    expect(store.snapshot().sessionClickCount).toBe(2);
  });
});

describe("profileStore.applyFavorite", () => {
  it("bumps categoryAffinity by the favorite weight", async () => {
    const store = await makeStore();
    await store.applyFavorite(makeItem({ category: "outdoors" }));
    expect(store.snapshot().categoryAffinity.outdoors).toBeCloseTo(
      SCORING_CONSTANTS.favoriteCategoryBump,
      10,
    );
  });
});

describe("profileStore.applyImpression", () => {
  it("does not mutate affinities", async () => {
    const store = await makeStore();
    await store.applyImpression(makeItem());
    expect(store.snapshot().categoryAffinity).toEqual({});
    expect(store.snapshot().tagAffinity).toEqual({});
  });
});

describe("profileStore — persistence", () => {
  it("persists across store recreation", async () => {
    const store1 = await makeStore();
    await store1.applyClick(makeItem({ category: "running" }));
    store1.close();
    const store2 = await makeStore();
    expect(store2.snapshot().categoryAffinity.running).toBeCloseTo(
      SCORING_CONSTANTS.clickCategoryBump,
      10,
    );
  });

  it("reset clears persisted profile", async () => {
    const store1 = await makeStore();
    await store1.applyClick(makeItem({ category: "running" }));
    await store1.reset();
    store1.close();
    const store2 = await makeStore();
    expect(store2.snapshot().categoryAffinity).toEqual({});
  });
});
