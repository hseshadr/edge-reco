import type {
  CandidateQuery,
  EdgeRecoSdk,
  EdgeRecoSdkOptions,
  ProfileSnapshot,
  RankedResponse,
  TrackOptions,
} from "./types.js";
import { createProfileStore, type ProfileStore } from "./lib/profile-store.js";
import {
  createCandidateClient,
  type CandidateClient,
} from "./lib/candidate-client.js";
import { createTracker, type Tracker } from "./lib/tracker.js";
import { rerank } from "./lib/reranker.js";

export interface CreateSdkOptions extends EdgeRecoSdkOptions {
  candidateClientOverride?: CandidateClient;
}

export async function createEdgeRecoSdk(
  opts: CreateSdkOptions,
): Promise<EdgeRecoSdk> {
  const profileStore: ProfileStore = await createProfileStore();
  const client: CandidateClient =
    opts.candidateClientOverride ??
    createCandidateClient({ apiBaseUrl: opts.apiBaseUrl });
  const tracker: Tracker = createTracker({
    profileStore,
    sendEvents: (events) => client.postEventBatch(events),
  });

  return {
    async init(): Promise<void> {
      /* profile already loaded in createProfileStore */
    },

    trackImpression(options: TrackOptions): void {
      return tracker.trackImpression(options) as unknown as void;
    },

    trackClick(options: TrackOptions): void {
      return tracker.trackClick(options) as unknown as void;
    },

    trackFavorite(options: TrackOptions): void {
      return tracker.trackFavorite(options) as unknown as void;
    },

    async getCandidates(query: CandidateQuery): Promise<RankedResponse> {
      const candidates = await client.fetchCandidates(query);
      tracker.rememberCandidates(candidates);
      return rerank(candidates, profileStore.snapshot());
    },

    getProfile(): ProfileSnapshot {
      return profileStore.snapshot();
    },

    async resetProfile(): Promise<void> {
      await profileStore.reset();
    },
  };
}

export type {
  EdgeRecoSdk,
  EdgeRecoSdkOptions,
  CatalogItem,
  ProfileSnapshot,
  RankedItem,
  RankedResponse,
  ScoreBreakdown,
  TrackOptions,
  CandidateQuery,
} from "./types.js";
