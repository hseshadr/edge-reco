import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NVMRC, nodeVersionVerdict } from "./check-node-version.mjs";

// The preflight's whole value is that it FAILS on skew rather than warning, and
// that it compares EXACTLY. These specs pin both properties, plus the contents
// of the failure message — a message that does not say which file pins what is
// the message a human scrolls past.

test("accepts the exact pinned version", () => {
	const verdict = nodeVersionVerdict("v24.16.0", "24.16.0\n");
	assert.equal(verdict.ok, true);
	assert.match(verdict.message, /24\.16\.0/);
});

test("tolerates the v-prefix and surrounding whitespace in the pin file", () => {
	const verdict = nodeVersionVerdict("v24.16.0", "  v24.16.0  \n");
	assert.equal(verdict.ok, true);
});

test("REJECTS a newer major — the direction that hides a Node-24-only pass", () => {
	const verdict = nodeVersionVerdict("v24.16.0", "22.13.0");
	assert.equal(verdict.ok, false);
});

test("REJECTS an older major — the direction that ships an untested runtime", () => {
	const verdict = nodeVersionVerdict("v22.13.0", "24.16.0");
	assert.equal(verdict.ok, false);
});

test("REJECTS a patch-level difference — exact match, not a floor", () => {
	// The decisive case: a `>=` floor would accept every one of these. Only an
	// exact comparison proves "identical to the runtime CI installs".
	for (const active of ["v24.16.1", "v24.17.0", "v25.0.0"]) {
		const verdict = nodeVersionVerdict(active, "24.16.0");
		assert.equal(verdict.ok, false, `${active} must not satisfy a 24.16.0 pin`);
	}
});

test("failure message names both versions, the pin file, and the fix command", () => {
	const { message } = nodeVersionVerdict("v22.13.0", "24.16.0");
	assert.match(message, /FAILED/);
	assert.match(message, /22\.13\.0/); // what is running
	assert.match(message, /24\.16\.0/); // what is pinned
	assert.match(message, /frontend\/\.nvmrc/); // which file pins it
	assert.match(message, /nvm install 24\.16\.0/); // the exact fix
});

test("an empty pin file fails rather than silently passing", () => {
	const verdict = nodeVersionVerdict("v24.16.0", "\n  \n");
	assert.equal(verdict.ok, false);
	assert.match(verdict.message, /empty/);
});

test("the committed .nvmrc is an exact three-part version, not a bare major", () => {
	// A bare major ("24") is what setup-node resolves to "latest 24.x" — which
	// silently drifts and cannot be matched exactly by this preflight. The pin
	// must name one build.
	const pinned = readFileSync(NVMRC, "utf8").trim();
	assert.match(
		pinned,
		/^\d+\.\d+\.\d+$/,
		`frontend/.nvmrc must pin an exact version, got "${pinned}"`,
	);
});

test("the running Node matches the committed pin (the live preflight)", () => {
	// This is the guard itself, executed as a test: if the suite is running on a
	// runtime CI does not use, say so here too rather than only in the gate step.
	const verdict = nodeVersionVerdict(
		process.version,
		readFileSync(NVMRC, "utf8"),
	);
	assert.equal(verdict.ok, true, verdict.message);
});
