// Regression tests for the `poe demo` edge preflight (check-edge.mjs).
//
// The preflight exists because of a CONFIRMED root cause: when another project
// (or a stale container) occupies :8081 and serves a *foreign-but-valid* signed
// bundle, the SPA fetches it (HTTP 200), fails the pinned-key verify, and the
// user sees the cryptic "signature verification failed". The preflight turns
// that into a clear, actionable terminal error BEFORE the browser opens.
//
// Zero-dep: node's built-in test runner (`node --test`), no live server — the
// transport is injected so every branch is exercised deterministically.

import assert from "node:assert/strict";
import { test } from "node:test";
import { checkEdge } from "./check-edge.mjs";

const COMMITTED = JSON.stringify({
	manifest_hash:
		"4ff1489ab4c76afe217f38b99f633215b4cf92a23344943012db0634a402973a",
	version: "v1",
	signature: "AAAA",
});

/** Fake fetch returning a 200 with the given body text. */
const ok200 = (body) => async () => ({
	ok: true,
	status: 200,
	statusText: "OK",
	text: async () => body,
});

test("passes when the edge serves OUR committed pointer", async () => {
	const result = await checkEdge({
		baseUrl: "http://localhost:8081",
		committedLatestText: COMMITTED,
		fetchImpl: ok200(COMMITTED),
	});
	assert.equal(result.ok, true);
});

test("fails when the edge serves a FOREIGN bundle (different manifest_hash)", async () => {
	const foreign = JSON.stringify({
		manifest_hash:
			"deadbeef00000000000000000000000000000000000000000000000000000000",
		version: "v1",
		signature: "ZZZZ",
	});
	const result = await checkEdge({
		baseUrl: "http://localhost:8081",
		committedLatestText: COMMITTED,
		fetchImpl: ok200(foreign),
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /different|foreign|another/i);
});

test("fails clearly when the edge is unreachable (fetch rejects)", async () => {
	const result = await checkEdge({
		baseUrl: "http://localhost:8081",
		committedLatestText: COMMITTED,
		fetchImpl: async () => {
			throw new Error("ECONNREFUSED");
		},
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /reach|unreachable|not running|up/i);
});

test("fails on a non-200 status (e.g. Caddy 502 while origin is down)", async () => {
	const result = await checkEdge({
		baseUrl: "http://localhost:8081",
		committedLatestText: COMMITTED,
		fetchImpl: async () => ({
			ok: false,
			status: 502,
			statusText: "Bad Gateway",
			text: async () => "upstream error",
		}),
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /502/);
});

test("fails on a malformed (non-JSON) /latest body", async () => {
	const result = await checkEdge({
		baseUrl: "http://localhost:8081",
		committedLatestText: COMMITTED,
		fetchImpl: ok200("<html>not json</html>"),
	});
	assert.equal(result.ok, false);
	assert.match(result.reason, /pars|json|invalid/i);
});
