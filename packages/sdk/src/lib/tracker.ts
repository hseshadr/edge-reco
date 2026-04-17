import type { CatalogItem, TrackOptions } from "../types.js";
import type { EventEnvelope } from "./candidate-client.js";
import type { ProfileStore } from "./profile-store.js";

export interface TrackerOptions {
  profileStore: Pick<ProfileStore, "applyClick" | "applyFavorite" | "applyImpression">;
  sendEvents: (events: EventEnvelope[]) => Promise<void>;
}

export interface Tracker {
  rememberCandidates(items: readonly CatalogItem[]): void;
  trackImpression(opts: TrackOptions): Promise<void>;
  trackClick(opts: TrackOptions): Promise<void>;
  trackFavorite(opts: TrackOptions): Promise<void>;
}

function newEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `evt_${Math.random().toString(36).slice(2)}${Date.now()}`;
}

function envelope(eventType: EventEnvelope["eventType"], opts: TrackOptions): EventEnvelope {
  return {
    eventId: newEventId(),
    eventType,
    itemId: opts.itemId,
    timestamp: new Date().toISOString(),
    contextType: opts.contextType,
  };
}

export function createTracker(opts: TrackerOptions): Tracker {
  const cache = new Map<string, CatalogItem>();

  return {
    rememberCandidates(items: readonly CatalogItem[]): void {
      for (const item of items) {
        cache.set(item.id, item);
      }
    },

    async trackImpression(options: TrackOptions): Promise<void> {
      const item = cache.get(options.itemId);
      if (item) await opts.profileStore.applyImpression(item);
      await opts.sendEvents([envelope("impression", options)]);
    },

    async trackClick(options: TrackOptions): Promise<void> {
      const item = cache.get(options.itemId);
      if (item) await opts.profileStore.applyClick(item);
      await opts.sendEvents([envelope("click", options)]);
    },

    async trackFavorite(options: TrackOptions): Promise<void> {
      const item = cache.get(options.itemId);
      if (item) await opts.profileStore.applyFavorite(item);
      await opts.sendEvents([envelope("favorite", options)]);
    },
  };
}
