// The deployed Content-Security-Policy has to agree with the mode the CATALOG BUNDLE
// was published in (`EDGERECO_IMAGE_MODE`, see backend/src/edgereco/catalog/product_image.py):
//
//   local  (default) — every photo was downloaded at build time and is served from our
//                      own origin, so `img-src 'self' data:` stands and a page load
//                      makes ZERO third-party requests.
//   remote           — the bundle keeps the catalog's own CDN urls, so those hosts must
//                      be listed explicitly.
//
// WHY EXPLICITLY: removing the `img-src` directive does NOT permit remote images. CSP
// falls back to `default-src`, which is `'self'` here, so the photos stay blocked and
// the deployment silently shows placeholders. The hosts have to be named.
//
// The list is derived from the catalog's ACTUAL image hosts (all 720 products resolve
// to m.media-amazon.com over https) — not from what Amazon might plausibly use. No
// wildcard: a wildcard would let any origin paint pixels into the page.

/** Every host the committed catalog's product photos are served from. */
export const REMOTE_IMAGE_HOSTS = ["https://m.media-amazon.com"];

/**
 * Return `csp` with `img-src` adjusted for `mode` ("local" | "remote").
 *
 * Only `img-src` is touched — notably NOT `connect-src`, because `img-src` permits an
 * `<img>` to paint while `connect-src` would let script read those bytes cross-origin,
 * a far larger grant that this feature never needs.
 *
 * Fails closed: a policy with no `img-src` cannot be widened, and silently returning it
 * unchanged would ship a remote-mode deployment that shows no photos at all.
 */
export function imgSrcForMode(csp, mode) {
	if (mode === "local") {
		return csp;
	}
	const directive = /img-src ([^;]+)/u.exec(csp);
	if (directive === null) {
		throw new Error(
			"the policy has no img-src directive to widen; deleting it does NOT allow " +
				"remote images (CSP falls back to default-src), so remote mode would ship blind",
		);
	}
	const sources = directive[1].trim();
	const missing = REMOTE_IMAGE_HOSTS.filter(
		(host) => !sources.split(/\s+/u).includes(host),
	);
	if (missing.length === 0) {
		return csp;
	}
	return csp.replace(
		/img-src ([^;]+)/u,
		() => `img-src ${sources} ${missing.join(" ")}`,
	);
}
