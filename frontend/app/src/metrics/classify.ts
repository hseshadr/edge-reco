/**
 * Classify a network request URL into a semantic bucket.
 * Used to count "real backend calls" vs images, uplink beacons, and edge CDN syncs.
 */

export type ResourceBucket = "asset" | "edge" | "image" | "uplink" | "other";

/** Root assets browsers may request lazily after the storefront is ready. */
const STATIC_ASSET_PATHS = new Set([
	"/favicon.ico",
	"/favicon.svg",
	"/pwa-192x192.png",
]);

export interface ClassifyOptions {
	/** The signed-bundle CDN origin (e.g. "https://cdn.example.com"). */
	readonly edgeOrigin: string;
	/** The optional analytics uplink URL. `null` or `undefined` means disabled. */
	readonly eventsUrl?: string | null;
	/**
	 * The app's own origin (e.g. `location.origin`). When set, same-origin
	 * release-owned static assets are excluded from backend calls. Omit to
	 * disable that rule.
	 */
	readonly appOrigin?: string | null;
}

/**
 * Bucket a URL into one of five categories.
 * Matching order (first match wins):
 *   1. "asset"  — a known same-origin static/PWA root asset
 *   2. "image"  — a product image: a same-origin `/images/…` asset baked into
 *                 the bundle and served locally, OR a host ending in
 *                 `media-amazon.com`
 *   3. "uplink" — URL starts with the origin of `opts.eventsUrl` (when set)
 *   4. "edge"   — URL's origin equals `opts.edgeOrigin`
 *   5. "other"  — everything else (including unparseable URLs)
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

	// 1. Release-owned root assets that browsers may load after readyAt. Exact
	// paths keep same-origin API/backend calls visible to the counter.
	if (
		opts.appOrigin != null &&
		parsed.origin === opts.appOrigin &&
		STATIC_ASSET_PATHS.has(parsed.pathname)
	) {
		return "asset";
	}

	// 2. Product images.
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

	// 3. Optional flywheel uplink — off the inference path, never gates the rail.
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

	// 4. Edge CDN — signed-bundle sync requests.
	if (parsed.origin === opts.edgeOrigin) {
		return "edge";
	}

	return "other";
}
