// A static origin that serves `dist/` the way CLOUDFLARE PAGES serves it in
// advanced mode — not the way `vite preview` serves it.
//
// WHY THIS EXISTS
// ---------------
// `vite preview` is a plain file server: every file in `dist/` is reachable at
// its own path. Cloudflare Pages is not. In advanced mode Pages CONSUMES four
// filenames as platform configuration and never publishes them as assets, so
// requesting them returns 404 even though the file is in the deployment.
//
// That difference is invisible to a preview-driven test and fatal in production:
// the generated service worker precached `_worker.js`, workbox's install is
// atomic, and one 404 entry aborted the whole install — so edge-reco.com shipped
// with NO service worker while the preview lane stayed green.
//
// Measured against https://edge-reco.com on 2026-08-06 — every rule below is a
// response the live origin actually returned, not an assumption:
//
//   /_worker.js /_headers /_redirects /_routes.json  -> 404
//   /index.html -> 308 /      /faq.html -> 308 /faq    /404.html -> 308 /404
//   /faq        -> 200 (faq.html)
//   unknown path -> 404 with the 404.html body
//   /*           -> the security headers from dist/_headers (incl. the CSP)
//
// Deliberately NOT modelled: the `_worker.js` www->apex redirect (unit-tested in
// scripts/canonical-worker.test.mjs) and `_redirects` rules (this deployment
// ships none). This harness models ASSET RESOLUTION, which is what the service
// worker's install depends on.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";

/**
 * Filenames Cloudflare Pages consumes as configuration. They live in the
 * deployment but are NOT served as assets: requesting one returns 404.
 * Anything the service worker precaches from this list kills its install.
 */
export const PAGES_RESERVED_PATHS = Object.freeze([
	"_worker.js",
	"_headers",
	"_redirects",
	"_routes.json",
]);

const MIME = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".key": "application/octet-stream",
	".mjs": "text/javascript; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
	".txt": "text/plain; charset=utf-8",
	".wasm": "application/wasm",
	".webmanifest": "application/manifest+json",
	".woff2": "font/woff2",
	".xml": "application/xml",
};

/**
 * The one production directive a loopback harness must NOT serve.
 *
 * `upgrade-insecure-requests` is a no-op on https://edge-reco.com — every request
 * is already https. On `http://127.0.0.1` it rewrites the scheme, so the hop that
 * follows a 308 (`/faq.html` -> `/faq`) is fetched as https and dies with
 * ERR_SSL_PROTOCOL_ERROR. Serving it here would fail the service-worker install
 * for a reason production does not have — a harness artifact masquerading as a
 * defect. Every other directive (notably `worker-src 'self' blob:` and
 * `script-src 'self' 'wasm-unsafe-eval'`) is served verbatim.
 */
const HTTPS_ONLY_CSP_DIRECTIVE = "upgrade-insecure-requests";

function stripHttpsOnlyDirectives(csp) {
	return csp
		.split(";")
		.map((directive) => directive.trim())
		.filter((directive) => directive !== HTTPS_ONLY_CSP_DIRECTIVE)
		.join("; ");
}

/** The `/*` block of a Cloudflare Pages `_headers` file, as a plain object. */
export function parseGlobalHeaders(headersText) {
	const headers = {};
	let inGlobalBlock = false;
	for (const rawLine of headersText.split("\n")) {
		const line = rawLine.trimEnd();
		if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
		if (!line.startsWith(" ") && !line.startsWith("\t")) {
			inGlobalBlock = line.trim() === "/*";
			continue;
		}
		if (!inGlobalBlock) continue;
		const entry = line.trim();
		if (entry.startsWith("!")) continue; // header REMOVAL directive
		const colon = entry.indexOf(":");
		if (colon > 0) {
			const name = entry.slice(0, colon).trim();
			const value = entry.slice(colon + 1).trim();
			headers[name] =
				name.toLowerCase() === "content-security-policy"
					? stripHttpsOnlyDirectives(value)
					: value;
		}
	}
	return headers;
}

/** Resolve a request pathname to a file in `dist`, applying Pages' rules. */
export function resolvePagesRequest(root, pathname) {
	const decoded = decodeURIComponent(pathname);
	const relative = normalize(decoded)
		.replace(/^(\.\.[/\\])+/, "")
		.slice(1);

	// 1. Platform configuration is never an asset.
	if (PAGES_RESERVED_PATHS.includes(relative)) return { kind: "not-found" };

	// 2. `.html` is canonicalised away: /faq.html -> /faq, /index.html -> /.
	if (relative.endsWith(".html")) {
		const bare = relative.slice(0, -".html".length);
		return { kind: "redirect", location: bare === "index" ? "/" : `/${bare}` };
	}

	// 3. Directory -> its index.html; extensionless -> its `.html` sibling.
	const candidates = relative === "" ? ["index.html"] : [relative];
	if (relative !== "" && extname(relative) === "") {
		candidates.push(`${relative}.html`, join(relative, "index.html"));
	}
	for (const candidate of candidates) {
		const absolute = join(root, candidate);
		if (!absolute.startsWith(root + sep)) continue; // traversal guard
		if (existsSync(absolute) && statSync(absolute).isFile()) {
			return { kind: "file", absolute };
		}
	}
	return { kind: "not-found" };
}

/**
 * Start the harness. Returns `{ url, close }`.
 * @param {{ root: string, port?: number }} options
 */
export function startPagesServer({ root, port = 0 }) {
	const globalHeaders = existsSync(join(root, "_headers"))
		? parseGlobalHeaders(readFileSync(join(root, "_headers"), "utf8"))
		: {};
	const notFoundBody = existsSync(join(root, "404.html"))
		? readFileSync(join(root, "404.html"))
		: Buffer.from("not found");

	const server = createServer((req, res) => {
		for (const [name, value] of Object.entries(globalHeaders)) {
			res.setHeader(name, value);
		}
		const { pathname } = new URL(req.url, "http://localhost");
		const resolved = resolvePagesRequest(root, pathname);

		if (resolved.kind === "redirect") {
			res.writeHead(308, { Location: resolved.location });
			res.end();
			return;
		}
		if (resolved.kind === "not-found") {
			res.writeHead(404, { "Content-Type": MIME[".html"] });
			res.end(notFoundBody);
			return;
		}
		res.writeHead(200, {
			"Content-Type":
				MIME[extname(resolved.absolute)] ?? "application/octet-stream",
		});
		createReadStream(resolved.absolute).pipe(res);
	});

	return new Promise((resolve) => {
		server.listen(port, "127.0.0.1", () => {
			resolve({
				url: `http://127.0.0.1:${server.address().port}`,
				close: () => new Promise((done) => server.close(done)),
			});
		});
	});
}
