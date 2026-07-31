// The deployed CSP has to MATCH the mode the catalog bundle was published in. Get it
// wrong and you either see no photos at all (remote bundle + strict policy) or you
// widen img-src for a build that never needed it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { imgSrcForMode, REMOTE_IMAGE_HOSTS } from "./imageCsp.mjs";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const STRICT =
	"default-src 'self'; connect-src 'self'; img-src 'self' data:; font-src 'self'";

test("local mode leaves the policy byte-identical", () => {
	// LOCAL serves every photo same-origin, so nothing may be widened.
	assert.equal(imgSrcForMode(STRICT, "local"), STRICT);
});

test("remote mode adds exactly the hosts the catalog uses", () => {
	const widened = imgSrcForMode(STRICT, "remote");

	assert.match(widened, /img-src 'self' data: https:\/\/m\.media-amazon\.com/u);
	// Only img-src moves; the rest is untouched.
	assert.equal(widened.replace(" https://m.media-amazon.com", ""), STRICT);
});

test("the allowlist is https-only and never a wildcard", () => {
	// A wildcard would let ANY host paint pixels into the page.
	assert.ok(!imgSrcForMode(STRICT, "remote").includes("*"));
	assert.ok(REMOTE_IMAGE_HOSTS.every((host) => host.startsWith("https://")));
});

test("connect-src is never widened, so photos cannot become readable fetches", () => {
	// img-src permits an <img> to paint. connect-src would let script READ those bytes
	// cross-origin — a much larger grant this feature never needs.
	assert.match(imgSrcForMode(STRICT, "remote"), /connect-src 'self';/u);
});

test("re-applying remote mode does not duplicate a host", () => {
	const once = imgSrcForMode(STRICT, "remote");
	assert.equal(imgSrcForMode(once, "remote"), once);
});

test("fails closed when there is no img-src directive to widen", () => {
	// Deleting img-src does NOT permit remote images: CSP falls back to default-src
	// 'self', which still blocks them. A missing directive must be loud, not silent.
	assert.throws(
		() => imgSrcForMode("default-src 'self'; font-src 'self'", "remote"),
		/img-src/u,
	);
});

test("the REAL committed _headers can be widened for remote mode", () => {
	// Guards the guard: if public/_headers ever loses its img-src, remote mode would
	// ship a deployment showing no photos, and this catches it at build time.
	const headers = readFileSync(join(APP_DIR, "public", "_headers"), "utf8");

	assert.match(headers, /img-src 'self' data:/u);
	assert.match(
		imgSrcForMode(headers, "remote"),
		/img-src 'self' data: https:\/\/m\.media-amazon\.com/u,
	);
	assert.equal(imgSrcForMode(headers, "local"), headers);
});
