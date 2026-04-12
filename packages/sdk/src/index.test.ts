import { describe, it, expect, vi } from "vitest";
import { createEdgeRecoSdk } from "./index.js";
import type { CatalogItem } from "./types.js";
import type {
  CandidateClient,
  EventEnvelope,
} from "./lib/candidate-client.js";

const items: CatalogItem[] = [
  {
    id: "run_1",
    title: "Running A",
    category: "running",
    tags: ["lightweight"],
    popularityScore: 0.2,
    freshnessScore: 0.5,
  },
  {
    id: "run_2",
    title: "Running B",
    category: "running",
    tags: ["waterproof"],
    popularityScore: 0.3,
    freshnessScore: 0.5,
  },
  {
    id: "formal_1",
    title: "Formal A",
    category: "formal",
    tags: ["leather"],
    popularityScore: 0.9,
    freshnessScore: 0.5,
  },
];

const stubClient: CandidateClient = {
  async fetchCandidates() {
    return [...items];
  },
  async postEventBatch(_events: EventEnvelope[]) {
    /* swallow */
  },
};

describe("createEdgeRecoSdk", () => {
  it("init loads a fresh profile", async () => {
    const sdk = await createEdgeRecoSdk({
      apiBaseUrl: "http://api.test",
      candidateClientOverride: stubClient,
    });
    await sdk.init();
    expect(sdk.getProfile().sessionClickCount).toBe(0);
    expect(sdk.getProfile().categoryAffinity).toEqual({});
  });

  it("ranks by popularity with empty profile then shifts after clicks", async () => {
    const sdk = await createEdgeRecoSdk({
      apiBaseUrl: "http://api.test",
      candidateClientOverride: stubClient,
    });
    await sdk.init();
    await sdk.resetProfile();

    const first = await sdk.getCandidates({
      contextType: "homepage",
      limit: 3,
    });
    expect(first.items[0]!.id).toBe("formal_1"); // highest popularity wins

    await sdk.trackClick({ itemId: "run_1", contextType: "homepage" });
    await sdk.trackClick({ itemId: "run_2", contextType: "homepage" });
    expect(sdk.getProfile().categoryAffinity.running).toBeCloseTo(0.2, 10);
    expect(sdk.getProfile().sessionClickCount).toBe(2);
  });

  it("fire-and-forgets events through the candidate client", async () => {
    const postSpy = vi.fn().mockResolvedValue(undefined);
    const client: CandidateClient = {
      async fetchCandidates() {
        return [...items];
      },
      postEventBatch: postSpy,
    };
    const sdk = await createEdgeRecoSdk({
      apiBaseUrl: "http://api.test",
      candidateClientOverride: client,
    });
    await sdk.init();
    await sdk.resetProfile();

    await sdk.getCandidates({ contextType: "homepage", limit: 3 });
    await sdk.trackClick({ itemId: "run_1", contextType: "homepage" });
    expect(postSpy).toHaveBeenCalled();
  });

  it("resetProfile clears IDB state", async () => {
    const sdk = await createEdgeRecoSdk({
      apiBaseUrl: "http://api.test",
      candidateClientOverride: stubClient,
    });
    await sdk.init();
    await sdk.resetProfile();

    await sdk.getCandidates({ contextType: "homepage", limit: 3 });
    await sdk.trackClick({ itemId: "run_1", contextType: "homepage" });
    expect(sdk.getProfile().sessionClickCount).toBe(1);
    await sdk.resetProfile();
    expect(sdk.getProfile().sessionClickCount).toBe(0);
    expect(sdk.getProfile().categoryAffinity).toEqual({});
  });
});
