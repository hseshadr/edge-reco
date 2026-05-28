// The transport seam: fetch raw bytes for a URL. Injectable so tests back the
// sync engine with the real examples/catalog files instead of the network.

import type { FetchBytes } from "./types";

export const fetchBytes: FetchBytes = async (url) => {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(
			`fetch ${url} failed: ${response.status} ${response.statusText}`,
		);
	}
	return new Uint8Array(await response.arrayBuffer());
};
