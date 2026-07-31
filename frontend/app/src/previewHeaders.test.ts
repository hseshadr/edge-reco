// The preview CSP must come from the REAL committed _headers file, not a copy —
// a drifted duplicate would let preview run a policy production doesn't ship.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cspFromHeadersFile, previewCsp } from "./previewHeaders";

const HEADERS_PATH = join(
	dirname(dirname(fileURLToPath(import.meta.url))),
	"public",
	"_headers",
);

describe("cspFromHeadersFile", () => {
	it("lifts the catch-all rule's policy from the real committed _headers", () => {
		const csp = cspFromHeadersFile(readFileSync(HEADERS_PATH, "utf-8"));

		// The directive this whole seam exists to make observable in preview: the
		// storefront's product cards must be same-origin, so a bundle carrying a
		// third-party CDN url renders nothing AND leaks nothing.
		expect(csp).toContain("img-src 'self' data:");
		expect(csp).toContain("default-src 'self'");
	});

	it("fails closed when there is no catch-all rule", () => {
		expect(() =>
			cspFromHeadersFile("/sw.js\n  Cache-Control: no-cache\n"),
		).toThrow(/no catch-all/);
	});

	it("fails closed when the catch-all rule carries no CSP", () => {
		expect(() =>
			cspFromHeadersFile("/*\n  X-Frame-Options: SAMEORIGIN\n"),
		).toThrow(/no Content-Security-Policy/);
	});

	it("stops at the end of the catch-all block", () => {
		// A CSP under a LATER, narrower rule must not be mistaken for the global one.
		const headers =
			"/*\n  X-Frame-Options: SAMEORIGIN\n\n/admin\n  Content-Security-Policy: x\n";
		expect(() => cspFromHeadersFile(headers)).toThrow(
			/no Content-Security-Policy/,
		);
	});
});

describe("previewCsp", () => {
	const real = () => readFileSync(HEADERS_PATH, "utf-8");

	it("serves the production policy verbatim for a same-origin bundle", () => {
		// Production's own shape: VITE_BUNDLE_BASE_URL=bundle (app-relative).
		expect(previewCsp(real(), "bundle")).toBe(cspFromHeadersFile(real()));
		expect(previewCsp(real(), undefined)).toBe(cspFromHeadersFile(real()));
	});

	it("allows only the cross-origin catalog server the offline harness runs", () => {
		const csp = previewCsp(real(), "http://localhost:8921/catalog");

		expect(csp).toContain("connect-src 'self' http://localhost:8921");
		// Path is irrelevant to CSP — the ORIGIN is what is granted.
		expect(csp).not.toContain("http://localhost:8921/catalog;");
	});

	it("never widens img-src, the directive that decides if a card renders", () => {
		// The harness allowance must not become a hole in the guard this seam exists
		// for: an off-origin product image stays blocked in every configuration.
		for (const base of [undefined, "bundle", "http://localhost:8921/catalog"]) {
			expect(previewCsp(real(), base)).toContain("img-src 'self' data:");
			expect(previewCsp(real(), base)).not.toContain(
				"img-src 'self' data: http",
			);
		}
	});
});
