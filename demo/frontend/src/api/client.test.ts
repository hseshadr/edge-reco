import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { catalogInfo, recommend, search, sendEvent } from "./client";
import type { InteractionEvent, SearchResponse } from "./types";

const API_BASE = "http://localhost:8000";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

function lastCall(): [string, RequestInit] {
	const mock = globalThis.fetch as ReturnType<typeof vi.fn>;
	const call = mock.mock.calls.at(-1);
	if (call === undefined) {
		throw new Error("fetch was not called");
	}
	return [call[0] as string, call[1] as RequestInit];
}

function headerValue(init: RequestInit, name: string): string | null {
	return new Headers(init.headers).get(name);
}

const sampleSearch: SearchResponse = {
	results: [],
	query: "headphones",
	total: 0,
};

describe("api client", () => {
	beforeEach(() => {
		localStorage.clear();
		localStorage.setItem("nimbus_session_id", "session-xyz");
		globalThis.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("search() hits /search with q and the X-Session-Id header", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse(sampleSearch),
		);

		const result = await search("headphones");

		const [url, init] = lastCall();
		expect(url).toBe(`${API_BASE}/search?q=headphones`);
		expect(init.method).toBe("GET");
		expect(headerValue(init, "X-Session-Id")).toBe("session-xyz");
		expect(result).toEqual(sampleSearch);
	});

	it("search() encodes limit and category options", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse(sampleSearch),
		);

		await search("shoes", { limit: 5, category: "footwear" });

		const [url] = lastCall();
		expect(url).toBe(`${API_BASE}/search?q=shoes&limit=5&category=footwear`);
	});

	it("search() throws on a non-2xx response", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse({ detail: "boom" }, 500),
		);

		await expect(search("x")).rejects.toThrow(/500/);
	});

	it("recommend() hits /recommend with limit and parses the body", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse({ results: [], session_clicks: 3 }),
		);

		const result = await recommend(8);

		const [url, init] = lastCall();
		expect(url).toBe(`${API_BASE}/recommend?limit=8`);
		expect(headerValue(init, "X-Session-Id")).toBe("session-xyz");
		expect(result.session_clicks).toBe(3);
	});

	it("sendEvent() POSTs a batch envelope to /events", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse({ received: 1 }),
		);
		const evt: InteractionEvent = {
			event_type: "click",
			product_id: "p1",
			timestamp: "2026-05-26T00:00:00Z",
		};

		await sendEvent(evt);

		const [url, init] = lastCall();
		expect(url).toBe(`${API_BASE}/events`);
		expect(init.method).toBe("POST");
		expect(headerValue(init, "Content-Type")).toBe("application/json");
		expect(JSON.parse(init.body as string)).toEqual({ events: [evt] });
	});

	it("catalogInfo() GETs /catalog/info", async () => {
		(globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
			jsonResponse({ count: 42 }),
		);

		const info = await catalogInfo();

		const [url] = lastCall();
		expect(url).toBe(`${API_BASE}/catalog/info`);
		expect(info).toEqual({ count: 42 });
	});
});
