// Bounded browser transport for the signed-bundle sync engine.

import { IntegrityError } from "./integrity";
import type { FetchBytes, FetchBytesOptions } from "./types";

export class NetworkError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "NetworkError";
	}
}

/** A response crossed its caller-owned byte ceiling. Integrity-class, not a
 * recoverable network outage: sync must never silently serve cache for it. */
export class ResponseTooLargeError extends IntegrityError {
	public constructor(message: string) {
		super(message);
		this.name = "ResponseTooLargeError";
	}
}

export const FETCH_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_FETCH_BYTES = 2 * 1024 * 1024;

function requestInit(
	signal: AbortSignal,
	options?: FetchBytesOptions,
): RequestInit {
	return options?.cache === undefined
		? { signal }
		: { signal, cache: options.cache };
}

function responseLimit(options?: FetchBytesOptions): number {
	const limit = options?.maxBytes ?? DEFAULT_MAX_FETCH_BYTES;
	if (!Number.isSafeInteger(limit) || limit < 1) {
		throw new ResponseTooLargeError(`invalid response byte cap ${limit}`);
	}
	return limit;
}

function timedOut(url: string): NetworkError {
	return new NetworkError(
		`fetch ${url} failed: timed out after ${FETCH_TIMEOUT_MS}ms`,
	);
}

async function raceTimeout<T>(
	operation: Promise<T>,
	url: string,
	controller: AbortController,
): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			controller.abort();
			reject(timedOut(url));
		}, FETCH_TIMEOUT_MS);
	});
	try {
		return await Promise.race([operation, timeout]);
	} finally {
		clearTimeout(timer);
	}
}

function contentLength(response: Response): number | null {
	const raw = response.headers.get("content-length");
	if (raw === null) return null;
	const parsed = Number(raw);
	return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function join(parts: ReadonlyArray<Uint8Array>, total: number): Uint8Array {
	const output = new Uint8Array(total);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.byteLength;
	}
	return output;
}

async function readCapped(
	response: Response,
	limit: number,
): Promise<Uint8Array> {
	const declared = contentLength(response);
	if (declared !== null && declared > limit) {
		throw new ResponseTooLargeError(
			`response Content-Length ${declared} exceeds ${limit}-byte cap`,
		);
	}
	if (response.body === null) {
		const bytes = new Uint8Array(await response.arrayBuffer());
		if (bytes.byteLength > limit) {
			throw new ResponseTooLargeError(
				`response body exceeds ${limit}-byte cap`,
			);
		}
		return bytes;
	}
	const reader = response.body.getReader();
	const parts: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			await reader.cancel();
			throw new ResponseTooLargeError(
				`response body exceeds ${limit}-byte cap`,
			);
		}
		parts.push(value);
	}
	return join(parts, total);
}

async function fetchAndRead(
	url: string,
	controller: AbortController,
	options?: FetchBytesOptions,
): Promise<Uint8Array> {
	let response: Response;
	try {
		response = await fetch(url, requestInit(controller.signal, options));
	} catch (cause) {
		throw new NetworkError(`fetch ${url} failed: network unreachable`, {
			cause,
		});
	}
	if (!response.ok) {
		throw new NetworkError(
			`fetch ${url} failed: ${response.status} ${response.statusText}`,
		);
	}
	return readCapped(response, responseLimit(options));
}

export const fetchBytes: FetchBytes = (url, options) => {
	const controller = new AbortController();
	return raceTimeout(fetchAndRead(url, controller, options), url, controller);
};
