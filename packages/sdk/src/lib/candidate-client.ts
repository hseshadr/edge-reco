import type { CandidateQuery, CatalogItem } from "../types.js";

export interface EventEnvelope {
  eventId: string;
  eventType: "impression" | "click" | "favorite";
  itemId: string;
  timestamp: string;
  contextType: string;
}

export interface CandidateClient {
  fetchCandidates(query: CandidateQuery): Promise<CatalogItem[]>;
  postEventBatch(events: EventEnvelope[]): Promise<void>;
}

export interface CandidateClientOptions {
  apiBaseUrl: string;
}

const TIMEOUT_MS = 4000;
const MAX_ATTEMPTS = 2;

async function fetchJson(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    const text = await res.text();
    const body = text.length > 0 ? (JSON.parse(text) as unknown) : null;
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function isRetryable(status: number): boolean {
  return status >= 500 || status === 429;
}

export function createCandidateClient(opts: CandidateClientOptions): CandidateClient {
  const candidatesUrl = `${opts.apiBaseUrl}/v0/candidates`;
  const eventsUrl = `${opts.apiBaseUrl}/v0/events`;

  return {
    async fetchCandidates(query: CandidateQuery): Promise<CatalogItem[]> {
      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const result = await fetchJson(candidatesUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(query),
          });
          if (result.ok) {
            return (result.body as { items: CatalogItem[] }).items;
          }
          if (!isRetryable(result.status)) {
            throw new Error(`HTTP ${result.status}`);
          }
          lastError = new Error(`Transient HTTP ${result.status}`);
        } catch (err) {
          lastError = err;
        }
      }
      throw lastError instanceof Error ? lastError : new Error("Candidate request failed");
    },

    async postEventBatch(events: EventEnvelope[]): Promise<void> {
      if (events.length === 0) return;
      try {
        await fetchJson(eventsUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events }),
        });
      } catch (err) {
        console.warn("edgereco: event uplink failed", err);
      }
    },
  };
}
