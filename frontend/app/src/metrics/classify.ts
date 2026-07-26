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
	/**
	 * The app's own origin (e.g. `location.origin`). When set, same-origin
	 * `/images/<id>.svg` requests are treated as local product-image assets
	 * (bucket "image"), not backend calls. Omit to disable that rule.
	 */
	readonly appOrigin?: string | null;
}

/**
 * Bucket a URL into one of four categories.
 * Matching order (first match wins):
 *   1. "image"  — a product image: a same-origin `/images/…` asset baked into
 *                 the bundle and served locally, OR a host ending in
 *                 `media-amazon.com`
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

	// 1. Product images.
	//   a) Local images baked into the signed bundle and served same-origin as
	//      /images/<id>.svg — static assets, not a backend call. Scoped to the
	//      app's OWN origin so a remote host with an /images/ path can never mask
	//      a real backend call. Checked before the edge rule so these never count
	//      even if the bundle is served from the app's own origin.
	if (
		opts.appOrigin != null &&
		parsed.origin === opts.appOrigin &&
		parsed.pathname.startsWith("/images/")
	) {
		return "image";
	}
	//   b) Legacy/remote product images from Amazon's media CDN.
	if (
		parsed.hostname === "media-amazon.com" ||
		parsed.hostname.endsWith(".media-amazon.com")
	) {
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
