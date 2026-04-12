import type {
  CatalogItem,
  ProfileSnapshot,
  RankedItem,
  RankedResponse,
  ScoreBreakdown,
} from "../types.js";

export const SCORING_WEIGHTS = {
  popularity: 0.5,
  category: 0.25,
  tag: 0.15,
  freshness: 0.1,
  repetitionPenalty: 0.3,
} as const;

function categoryMatch(item: CatalogItem, profile: ProfileSnapshot): number {
  return profile.categoryAffinity[item.category] ?? 0;
}

function tagMatch(item: CatalogItem, profile: ProfileSnapshot): number {
  if (item.tags.length === 0) return 0;
  const total = item.tags.reduce((sum, tag) => sum + (profile.tagAffinity[tag] ?? 0), 0);
  return total / item.tags.length;
}

function repetitionPenalty(item: CatalogItem, profile: ProfileSnapshot): number {
  return profile.recentlyViewed.includes(item.id) ? SCORING_WEIGHTS.repetitionPenalty : 0;
}

function scoreItem(item: CatalogItem, profile: ProfileSnapshot): RankedItem {
  const popularity = SCORING_WEIGHTS.popularity * item.popularityScore;
  const catMatch = SCORING_WEIGHTS.category * categoryMatch(item, profile);
  const tags = SCORING_WEIGHTS.tag * tagMatch(item, profile);
  const freshness = SCORING_WEIGHTS.freshness * item.freshnessScore;
  const penalty = repetitionPenalty(item, profile);

  const breakdown: ScoreBreakdown = {
    popularity,
    categoryMatch: catMatch,
    tagMatch: tags,
    freshness,
    repetitionPenalty: penalty,
  };

  return {
    ...item,
    finalScore: popularity + catMatch + tags + freshness - penalty,
    scoreBreakdown: breakdown,
  };
}

export function rerank(
  candidates: readonly CatalogItem[],
  profile: ProfileSnapshot,
): RankedResponse {
  const ranked = candidates.map((item) => scoreItem(item, profile));
  ranked.sort((a, b) => b.finalScore - a.finalScore);
  return { items: ranked, rawItems: [...candidates] };
}
