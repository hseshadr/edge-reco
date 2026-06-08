/**
 * Classify a network request URL into a semantic bucket.
 * Used to count "real backend calls" vs images, uplink beacons, and edge CDN syncs.
 */

export type ResourceBucket = "edge" | "image" | "uplink" | "other";

export interface ClassifyOptions {
	/** The signed-bundle CDN origin (e.g. "https://cdn.example.com"). */
	readonly edgeOrigin: string;
	/** The optional analytics uplink URL. `null` or `undefined` means disabled. */
	readonly eventsUrl?: string | null;
}

/**
 * Bucket a URL into one of four categories.
 * Matching order (first match wins):
 *   1. "image"  — host ends with `media-amazon.com`
 *   2. "uplink" — URL starts with the origin of `opts.eventsUrl` (when set)
 *   3. "edge"   — URL's origin equals `opts.edgeOrigin`
 *   4. "other"  — everything else (including unparseable URLs)
 */
export function classifyResource(
	url: string,
	opts: ClassifyOptions,
): ResourceBucket {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return "other";
	}

	// 1. Product images from Amazon's media CDN — not a backend call.
	if (parsed.host.endsWith("media-amazon.com")) {
		return "image";
	}

	// 2. Optional flywheel uplink — off the inference path, never gates the rail.
	if (opts.eventsUrl != null) {
		try {
			const eventsOrigin = new URL(opts.eventsUrl).origin;
			if (parsed.origin === eventsOrigin) {
				return "uplink";
			}
		} catch {
			// If eventsUrl is itself unparseable, skip the uplink check.
		}
	}

	// 3. Edge CDN — signed-bundle sync requests.
	if (parsed.origin === opts.edgeOrigin) {
		return "edge";
	}

	return "other";
}
