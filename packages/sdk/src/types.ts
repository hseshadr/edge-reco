export interface CatalogItem {
  id: string;
  title: string;
  category: string;
  tags: readonly string[];
  popularityScore: number;
  freshnessScore: number;
}

export interface ProfileSnapshot {
  categoryAffinity: Readonly<Record<string, number>>;
  tagAffinity: Readonly<Record<string, number>>;
  recentlyViewed: readonly string[];
  sessionClickCount: number;
}

export interface TrackOptions {
  itemId: string;
  contextType: string;
}

export interface CandidateQuery {
  contextType: string;
  categoryHint?: string;
  limit: number;
}

export interface ScoreBreakdown {
  popularity: number;
  categoryMatch: number;
  tagMatch: number;
  freshness: number;
  repetitionPenalty: number;
}

export interface RankedItem extends CatalogItem {
  finalScore: number;
  scoreBreakdown: ScoreBreakdown;
}

export interface RankedResponse {
  items: readonly RankedItem[];
  rawItems: readonly CatalogItem[];
}

export interface EdgeRecoSdkOptions {
  apiBaseUrl: string;
}

export interface EdgeRecoSdk {
  init(): Promise<void>;
  trackImpression(opts: TrackOptions): void;
  trackClick(opts: TrackOptions): void;
  trackFavorite(opts: TrackOptions): void;
  getCandidates(query: CandidateQuery): Promise<RankedResponse>;
  getProfile(): ProfileSnapshot;
  resetProfile(): Promise<void>;
}
