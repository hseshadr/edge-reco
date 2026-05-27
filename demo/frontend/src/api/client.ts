import { getSessionId } from "../session";
import type {
	InteractionEvent,
	RecommendResponse,
	SearchResponse,
} from "./types";

const API_BASE: string = import.meta.env.VITE_API_BASE;

interface SearchOptions {
	limit?: number;
	category?: string;
}

function buildHeaders(extra?: Record<string, string>): Headers {
	const headers = new Headers(extra);
	headers.set("X-Session-Id", getSessionId());
	return headers;
}

async function request(path: string, init?: RequestInit): Promise<Response> {
	const response = await fetch(`${API_BASE}${path}`, init);
	if (!response.ok) {
		throw new Error(
			`Request to ${path} failed: ${response.status} ${response.statusText}`,
		);
	}
	return response;
}

export async function search(
	q: string,
	opts?: SearchOptions,
): Promise<SearchResponse> {
	const params = new URLSearchParams({ q });
	if (opts?.limit !== undefined) {
		params.set("limit", String(opts.limit));
	}
	if (opts?.category !== undefined) {
		params.set("category", opts.category);
	}
	const response = await request(`/search?${params.toString()}`, {
		method: "GET",
		headers: buildHeaders(),
	});
	return (await response.json()) as SearchResponse;
}

export async function recommend(limit?: number): Promise<RecommendResponse> {
	const params = new URLSearchParams();
	if (limit !== undefined) {
		params.set("limit", String(limit));
	}
	const query = params.toString();
	const response = await request(`/recommend${query ? `?${query}` : ""}`, {
		method: "GET",
		headers: buildHeaders(),
	});
	return (await response.json()) as RecommendResponse;
}

export async function sendEvent(evt: InteractionEvent): Promise<void> {
	// edge-reco's POST /events accepts a batch envelope: {"events": [...]}.
	await request("/events", {
		method: "POST",
		headers: buildHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify({ events: [evt] }),
	});
}

export async function catalogInfo(): Promise<unknown> {
	const response = await request("/catalog/info", {
		method: "GET",
		headers: buildHeaders(),
	});
	return (await response.json()) as unknown;
}
