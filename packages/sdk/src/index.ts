import { type CandidateClient, createCandidateClient } from "./lib/candidate-client.js";
import { type ProfileStore, createProfileStore } from "./lib/profile-store.js";
import { rerank } from "./lib/reranker.js";
import { type Tracker, createTracker } from "./lib/tracker.js";
import type {
  CandidateQuery,
  EdgeRecoSdk,
  EdgeRecoSdkOptions,
  ProfileSnapshot,
  RankedResponse,
  TrackOptions,
} from "./types.js";

export interface CreateSdkOptions extends EdgeRecoSdkOptions {
  candidateClientOverride?: CandidateClient;
}

export async function createEdgeRecoSdk(opts: CreateSdkOptions): Promise<EdgeRecoSdk> {
  const profileStore: ProfileStore = await createProfileStore();
  const client: CandidateClient =
    opts.candidateClientOverride ?? createCandidateClient({ apiBaseUrl: opts.apiBaseUrl });
  const tracker: Tracker = createTracker({
    profileStore,
    sendEvents: (events) => client.postEventBatch(events),
  });

  return {
    async init(): Promise<void> {
      /* profile already loaded in createProfileStore */
    },

    trackImpression(options: TrackOptions): Promise<void> {
      return tracker.trackImpression(options);
    },

    trackClick(options: TrackOptions): Promise<void> {
      return tracker.trackClick(options);
    },

    trackFavorite(options: TrackOptions): Promise<void> {
      return tracker.trackFavorite(options);
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
