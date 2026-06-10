// Tests for the GitHub Pages build helpers (build-pages.mjs).
//
// The Pages build is the normal production build plus two knobs: a subpath
// Vite base (project pages serve at /<repo>/) and an app-relative bundle URL
// (the committed catalog is copied same-origin into dist/bundle). These tests
// pin the env contract — defaults applied, caller overrides respected — and
// the copy-source location, without spawning a real build.

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { CATALOG_DIR, pagesEnv } from "./build-pages.mjs";

test("pagesEnv defaults VITE_BASE and VITE_BUNDLE_BASE_URL for Pages", () => {
	const env = pagesEnv({ PATH: "/usr/bin" });
	assert.equal(env.VITE_BASE, "/edge-reco/");
	assert.equal(env.VITE_BUNDLE_BASE_URL, "bundle");
	assert.equal(env.PATH, "/usr/bin", "existing env must pass through");
});

test("pagesEnv respects caller overrides (forks deploy under their repo name)", () => {
	const env = pagesEnv({
		VITE_BASE: "/my-fork/",
		VITE_BUNDLE_BASE_URL: "https://cdn.example.com/cat",
	});
	assert.equal(env.VITE_BASE, "/my-fork/");
	assert.equal(env.VITE_BUNDLE_BASE_URL, "https://cdn.example.com/cat");
});

test("pagesEnv never injects VITE_EVENTS_URL (the hosted demo has no uplink)", () => {
	assert.equal(pagesEnv({}).VITE_EVENTS_URL, undefined);
});

test("CATALOG_DIR points at the committed signed bundle (latest pointer present)", () => {
	assert.ok(
		existsSync(join(CATALOG_DIR, "latest")),
		`expected a signed bundle at ${CATALOG_DIR}`,
	);
});
