import type { CatalogItem, ProfileSnapshot } from "../types.js";
import {
  createProfileStorage,
  type ProfileStorage,
  type PersistedProfile,
} from "./storage.js";

export const SCORING_CONSTANTS = {
  clickCategoryBump: 0.1,
  favoriteCategoryBump: 0.2,
  clickTagBump: 0.05,
  favoriteTagBump: 0.05,
  recentlyViewedCap: 20,
  repetitionPenalty: 0.3,
} as const;

export interface ProfileStore {
  snapshot(): ProfileSnapshot;
  applyImpression(item: CatalogItem): Promise<void>;
  applyClick(item: CatalogItem): Promise<void>;
  applyFavorite(item: CatalogItem): Promise<void>;
  reset(): Promise<void>;
  close(): void;
}

interface MutableProfile {
  categoryAffinity: Record<string, number>;
  tagAffinity: Record<string, number>;
  recentlyViewed: string[];
  sessionClickCount: number;
}

function emptyProfile(): MutableProfile {
  return {
    categoryAffinity: {},
    tagAffinity: {},
    recentlyViewed: [],
    sessionClickCount: 0,
  };
}

function bumpCapped(current: number | undefined, delta: number): number {
  return Math.min(1.0, (current ?? 0) + delta);
}

function prependCapped(list: string[], id: string, cap: number): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, cap);
}

function toSnapshot(p: MutableProfile): ProfileSnapshot {
  return {
    categoryAffinity: { ...p.categoryAffinity },
    tagAffinity: { ...p.tagAffinity },
    recentlyViewed: [...p.recentlyViewed],
    sessionClickCount: p.sessionClickCount,
  };
}

function toPersisted(p: MutableProfile): PersistedProfile {
  return {
    categoryAffinity: { ...p.categoryAffinity },
    tagAffinity: { ...p.tagAffinity },
    recentlyViewed: [...p.recentlyViewed],
    sessionClickCount: p.sessionClickCount,
  };
}

function fromPersisted(p: PersistedProfile): MutableProfile {
  return {
    categoryAffinity: { ...p.categoryAffinity },
    tagAffinity: { ...p.tagAffinity },
    recentlyViewed: [...p.recentlyViewed],
    sessionClickCount: p.sessionClickCount,
  };
}

export async function createProfileStore(
  storage?: ProfileStorage,
): Promise<ProfileStore> {
  const backing = storage ?? (await createProfileStorage());
  const loaded = await backing.load();
  let state: MutableProfile = loaded ? fromPersisted(loaded) : emptyProfile();

  async function persist(): Promise<void> {
    await backing.save(toPersisted(state));
  }

  return {
    snapshot(): ProfileSnapshot {
      return toSnapshot(state);
    },

    async applyImpression(_item: CatalogItem): Promise<void> {
      /* Phase 0: no-op */
    },

    async applyClick(item: CatalogItem): Promise<void> {
      state.categoryAffinity[item.category] = bumpCapped(
        state.categoryAffinity[item.category],
        SCORING_CONSTANTS.clickCategoryBump,
      );
      for (const tag of item.tags) {
        state.tagAffinity[tag] = bumpCapped(
          state.tagAffinity[tag],
          SCORING_CONSTANTS.clickTagBump,
        );
      }
      state.recentlyViewed = prependCapped(
        state.recentlyViewed,
        item.id,
        SCORING_CONSTANTS.recentlyViewedCap,
      );
      state.sessionClickCount += 1;
      await persist();
    },

    async applyFavorite(item: CatalogItem): Promise<void> {
      state.categoryAffinity[item.category] = bumpCapped(
        state.categoryAffinity[item.category],
        SCORING_CONSTANTS.favoriteCategoryBump,
      );
      for (const tag of item.tags) {
        state.tagAffinity[tag] = bumpCapped(
          state.tagAffinity[tag],
          SCORING_CONSTANTS.favoriteTagBump,
        );
      }
      state.recentlyViewed = prependCapped(
        state.recentlyViewed,
        item.id,
        SCORING_CONSTANTS.recentlyViewedCap,
      );
      await persist();
    },

    async reset(): Promise<void> {
      state = emptyProfile();
      await backing.clear();
    },

    close(): void {
      backing.close();
    },
  };
}
