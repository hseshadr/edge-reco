// The transport seam: fetch raw bytes for a URL. Injectable so tests back the
// sync engine with the real examples/catalog files instead of the network.

import type { FetchBytes } from "./types";

/**
 * The transport could not reach the origin: offline, DNS failure, or a server
 * status that signals unreachability rather than a tampered response. This is
 * the ONLY failure class `syncIndex` is allowed to recover from by serving the
 * cached active version — integrity/signature failures must always propagate.
 */
export class NetworkError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "NetworkError";
	}
}

export const fetchBytes: FetchBytes = async (url) => {
	let response: Response;
	try {
		response = await fetch(url);
	} catch (cause) {
		// `fetch` rejects on a network-level failure (offline, DNS, CORS).
		throw new NetworkError(`fetch ${url} failed: network unreachable`, {
			cause,
		});
	}
	if (!response.ok) {
		throw new NetworkError(
			`fetch ${url} failed: ${response.status} ${response.statusText}`,
		);
	}
	return new Uint8Array(await response.arrayBuffer());
};
