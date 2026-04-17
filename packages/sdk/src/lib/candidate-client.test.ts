import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "../types.js";
import { createCandidateClient } from "./candidate-client.js";

const sampleItem: CatalogItem = {
  id: "a",
  title: "A",
  category: "running",
  tags: ["lightweight"],
  popularityScore: 0.5,
  freshnessScore: 0.5,
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("candidateClient.fetchCandidates", () => {
  it("POSTs to /v0/candidates and returns items", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [sampleItem] }));
    const client = createCandidateClient({ apiBaseUrl: "http://api.test" });
    const result = await client.fetchCandidates({
      contextType: "homepage",
      limit: 10,
    });
    expect(result).toEqual([sampleItem]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/v0/candidates");
    expect(init!.method).toBe("POST");
  });

  it("retries once on 5xx then returns the success body", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ detail: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse({ items: [sampleItem] }));
    const client = createCandidateClient({ apiBaseUrl: "http://api.test" });
    const result = await client.fetchCandidates({
      contextType: "homepage",
      limit: 5,
    });
    expect(result).toEqual([sampleItem]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws after a second failure", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({}, 503));
    const client = createCandidateClient({ apiBaseUrl: "http://api.test" });
    await expect(client.fetchCandidates({ contextType: "homepage", limit: 5 })).rejects.toThrow();
  });
});

describe("candidateClient.postEventBatch", () => {
  it("POSTs to /v0/events", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ received: 1 }, 202));
    const client = createCandidateClient({ apiBaseUrl: "http://api.test" });
    await client.postEventBatch([
      {
        eventId: "e1",
        eventType: "click",
        itemId: "a",
        timestamp: new Date().toISOString(),
        contextType: "homepage",
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/v0/events");
  });

  it("does not throw when the server rejects", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const client = createCandidateClient({ apiBaseUrl: "http://api.test" });
    await expect(
      client.postEventBatch([
        {
          eventId: "e1",
          eventType: "click",
          itemId: "a",
          timestamp: new Date().toISOString(),
          contextType: "homepage",
        },
      ]),
    ).resolves.toBeUndefined();
  });
});
