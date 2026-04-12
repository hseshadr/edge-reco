import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type PersistedProfile, type ProfileStorage, createProfileStorage } from "./storage.js";

let storage: ProfileStorage;

afterEach(() => {
  storage.close();
  indexedDB.deleteDatabase("edgereco");
});

describe("createProfileStorage", () => {
  it("returns null when no profile has been persisted", async () => {
    storage = await createProfileStorage();
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });

  it("round-trips a persisted profile", async () => {
    storage = await createProfileStorage();
    const profile: PersistedProfile = {
      categoryAffinity: { running: 0.7 },
      tagAffinity: { lightweight: 0.5 },
      recentlyViewed: ["item_1", "item_2"],
      sessionClickCount: 3,
    };
    await storage.save(profile);
    const loaded = await storage.load();
    expect(loaded).toEqual(profile);
  });

  it("clear removes the persisted profile", async () => {
    storage = await createProfileStorage();
    await storage.save({
      categoryAffinity: { running: 0.7 },
      tagAffinity: {},
      recentlyViewed: [],
      sessionClickCount: 0,
    });
    await storage.clear();
    const loaded = await storage.load();
    expect(loaded).toBeNull();
  });
});
