// Build-time helper for `previewProdCspPlugin` (vite.config.ts).
//
// `public/_headers` is Cloudflare Pages' header file — production parses it, but
// plain `vite preview` serves NO headers at all. Every preview-driven e2e lane
// (tests/e2e-offline, which runs the REAL production build) therefore ran under a
// materially looser policy than production: nothing in CI could observe an
// `img-src` or `connect-src` violation, so a resource the live CSP blocks sails
// through green and only breaks on edge-reco.com.
//
// This parser lifts the catch-all `/*` block's Content-Security-Policy so preview
// can serve the REAL production policy. Tested in previewHeaders.test.ts against
// the real committed file.

/**
 * Return the Content-Security-Policy value of the catch-all `/*` rule.
 *
 * Fails closed: a missing block or a missing CSP throws rather than yielding a
 * silent, CSP-less preview that would blind the e2e gates it exists to sharpen.
 */
export function cspFromHeadersFile(headersFileContent: string): string {
	const lines = headersFileContent.split("\n");
	const start = lines.findIndex((line) => line.trim() === "/*");
	if (start === -1) {
		throw new Error(
			"public/_headers has no catch-all `/*` rule — cannot derive the preview CSP",
		);
	}
	for (const line of lines.slice(start + 1)) {
		if (!/^\s+\S/.test(line)) {
			break; // an un-indented line ends the /* block
		}
		const policy = line.match(/^\s+Content-Security-Policy:\s*(.+?)\s*$/i)?.[1];
		if (policy !== undefined) {
			return policy;
		}
	}
	throw new Error(
		"the `/*` rule in public/_headers carries no Content-Security-Policy — " +
			"preview would silently run without the production CSP",
	);
}

/**
 * The production CSP, adjusted ONLY for a preview harness that serves the signed
 * bundle from a second origin.
 *
 * Production serves the bundle same-origin (`VITE_BUNDLE_BASE_URL=bundle`, copied
 * to `dist/bundle`), so `connect-src 'self'` is exactly right there. The offline
 * e2e lane deliberately runs a SEPARATE catalog server on another port to exercise
 * the sync path, and `connect-src 'self'` would block it — a harness artifact, not
 * a product defect. So an ABSOLUTE bundle origin is added to `connect-src` only.
 *
 * Every other directive — `img-src 'self' data:` above all, the one that decides
 * whether a product card can render — is served verbatim, so the guard it provides
 * is never weakened by this allowance.
 */
export function previewCsp(
	headersFileContent: string,
	bundleBaseUrl: string | undefined,
): string {
	const csp = cspFromHeadersFile(headersFileContent);
	const origin = absoluteOrigin(bundleBaseUrl);
	if (origin === null) {
		return csp;
	}
	// A replacer FUNCTION, not a replacement string: "$&", "$`" and "$'" are special
	// inside a replacement string and a `$` survives URL origin parsing, so a string
	// here would let the origin rewrite the policy around it. Case-insensitive to
	// match the header-name lookup above — a `Connect-Src` spelling would otherwise
	// make this silently no-op.
	return csp.replace(
		/connect-src ([^;]+)/iu,
		(_match, sources: string) => `connect-src ${sources} ${origin}`,
	);
}

/** The origin of an absolute bundle base url; `null` when app-relative (production). */
function absoluteOrigin(bundleBaseUrl: string | undefined): string | null {
	if (bundleBaseUrl === undefined || bundleBaseUrl === "") {
		return null;
	}
	try {
		return new URL(bundleBaseUrl).origin;
	} catch {
		return null; // app-relative ("bundle") — already covered by 'self'
	}
}
