import { describe, it, expect, vi, beforeEach } from "vitest";
import { createTracker } from "./tracker.js";
import type { CatalogItem } from "../types.js";

const itemRunning: CatalogItem = {
  id: "run_1",
  title: "Running shoe",
  category: "running",
  tags: ["lightweight"],
  popularityScore: 0.5,
  freshnessScore: 0.5,
};
const itemFormal: CatalogItem = {
  id: "formal_1",
  title: "Leather boot",
  category: "formal",
  tags: ["leather"],
  popularityScore: 0.5,
  freshnessScore: 0.5,
};

let profileStore: {
  applyClick: ReturnType<typeof vi.fn>;
  applyFavorite: ReturnType<typeof vi.fn>;
  applyImpression: ReturnType<typeof vi.fn>;
};
let eventSink: ReturnType<typeof vi.fn>;

beforeEach(() => {
  profileStore = {
    applyClick: vi.fn().mockResolvedValue(undefined),
    applyFavorite: vi.fn().mockResolvedValue(undefined),
    applyImpression: vi.fn().mockResolvedValue(undefined),
  };
  eventSink = vi.fn().mockResolvedValue(undefined);
});

describe("tracker.rememberCandidates + trackClick", () => {
  it("looks up metadata and calls profileStore.applyClick with the full item", async () => {
    const tracker = createTracker({
      profileStore,
      sendEvents: eventSink,
    });
    tracker.rememberCandidates([itemRunning, itemFormal]);
    await tracker.trackClick({ itemId: "run_1", contextType: "homepage" });
    expect(profileStore.applyClick).toHaveBeenCalledWith(itemRunning);
  });

  it("sends a click event even when metadata is missing", async () => {
    const tracker = createTracker({
      profileStore,
      sendEvents: eventSink,
    });
    await tracker.trackClick({ itemId: "unknown", contextType: "homepage" });
    expect(profileStore.applyClick).not.toHaveBeenCalled();
    expect(eventSink).toHaveBeenCalledTimes(1);
    const batch = eventSink.mock.calls[0]![0] as {
      eventType: string;
      itemId: string;
    }[];
    expect(batch[0]!.eventType).toBe("click");
    expect(batch[0]!.itemId).toBe("unknown");
  });
});

describe("tracker.trackImpression", () => {
  it("calls applyImpression and sends the event", async () => {
    const tracker = createTracker({
      profileStore,
      sendEvents: eventSink,
    });
    tracker.rememberCandidates([itemRunning]);
    await tracker.trackImpression({
      itemId: "run_1",
      contextType: "homepage",
    });
    expect(profileStore.applyImpression).toHaveBeenCalledWith(itemRunning);
    expect(eventSink).toHaveBeenCalledTimes(1);
  });
});

describe("tracker.trackFavorite", () => {
  it("calls applyFavorite and emits a favorite event", async () => {
    const tracker = createTracker({
      profileStore,
      sendEvents: eventSink,
    });
    tracker.rememberCandidates([itemRunning]);
    await tracker.trackFavorite({
      itemId: "run_1",
      contextType: "homepage",
    });
    expect(profileStore.applyFavorite).toHaveBeenCalledWith(itemRunning);
    expect(eventSink).toHaveBeenCalledTimes(1);
  });
});
