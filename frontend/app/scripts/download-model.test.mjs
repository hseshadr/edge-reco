// Preflight regression suite for the model self-hosting prebuild
// (download-model.mjs). Runs under `pnpm run test:preflight` (node:test) —
// pure-logic coverage only; the network path is exercised by the prebuild
// itself and the cold-CDN-blocked e2e proves the runtime result.

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	backoffDelay,
	fetchBytes,
	HF_BASE,
	isRetryableStatus,
	MAX_ATTEMPTS,
	MODEL_FILES,
	MODEL_ID,
	needsDownload,
	PAGES_MAX_ASSET_BYTES,
	parseRetryAfter,
	RETRY_AFTER_CAP_MS,
	sha256Hex,
	sourceUrl,
	verifyDigest,
} from "./download-model.mjs";

test("every self-hosted file fits under the Cloudflare Pages 25 MiB asset limit", () => {
	// The deploy constraint, encoded: Pages rejects any single asset > 25 MiB.
	// A model bump that would break the deploy must fail HERE, not on Pages.
	for (const file of MODEL_FILES) {
		assert.ok(
			file.size < PAGES_MAX_ASSET_BYTES,
			`${file.path} (${file.size} B) exceeds the Pages limit (${PAGES_MAX_ASSET_BYTES} B)`,
		);
	}
});

test("the file manifest is the q8 feature-extraction set", () => {
	const paths = MODEL_FILES.map((f) => f.path);
	assert.deepEqual(paths, [
		"config.json",
		"tokenizer.json",
		"tokenizer_config.json",
		"special_tokens_map.json",
		"onnx/model_quantized.onnx", // dtype "q8" ⇒ the _quantized export
	]);
	for (const file of MODEL_FILES) {
		assert.match(file.sha256, /^[0-9a-f]{64}$/);
	}
});

test("sourceUrl targets the hub's immutable resolve/main path", () => {
	assert.equal(
		sourceUrl("onnx/model_quantized.onnx"),
		`${HF_BASE}/${MODEL_ID}/resolve/main/onnx/model_quantized.onnx`,
	);
});

test("needsDownload: only a byte-identical on-disk file is skipped", () => {
	assert.equal(needsDownload("abc", "abc"), false);
	assert.equal(needsDownload("abc", "def"), true); // wrong content → refetch
	assert.equal(needsDownload("abc", undefined), true); // absent → fetch
});

test("verifyDigest: accepts a pinned body, rejects a tampered one", () => {
	const bytes = new TextEncoder().encode("hello");
	const file = { path: "x", sha256: sha256Hex(bytes) };
	assert.equal(verifyDigest(file, bytes), bytes);
	assert.throws(
		() => verifyDigest(file, new TextEncoder().encode("hellO")),
		/sha256 mismatch/,
	);
});

test("isRetryableStatus: 429/5xx retry, other 4xx fail fast", () => {
	assert.equal(isRetryableStatus(429), true);
	assert.equal(isRetryableStatus(500), true);
	assert.equal(isRetryableStatus(503), true);
	assert.equal(isRetryableStatus(404), false);
	assert.equal(isRetryableStatus(403), false);
});

test("parseRetryAfter: seconds and HTTP-date parse, junk yields undefined, capped", () => {
	assert.equal(parseRetryAfter("2"), 2000);
	assert.equal(parseRetryAfter("9999"), RETRY_AFTER_CAP_MS); // capped
	assert.equal(parseRetryAfter("-1"), undefined);
	assert.equal(parseRetryAfter("soon"), undefined);
	assert.equal(parseRetryAfter(undefined), undefined);
	const inTwoSec = new Date(Date.now() + 2000).toUTCString();
	const parsed = parseRetryAfter(inTwoSec);
	assert.ok(parsed !== undefined && parsed >= 0 && parsed <= 3000);
});

test("backoffDelay: honors Retry-After, else jittered exponential, always capped", () => {
	assert.equal(backoffDelay(1, 1234), 1234);
	assert.equal(backoffDelay(1, 999_999), RETRY_AFTER_CAP_MS);
	for (const attempt of [1, 3, 8]) {
		const d = backoffDelay(attempt, undefined);
		assert.ok(d > 0 && d <= RETRY_AFTER_CAP_MS);
	}
});

test("fetchBytes: retries transient failures then succeeds", async () => {
	let calls = 0;
	const body = new Uint8Array([1, 2, 3]).buffer;
	const flaky = async () => {
		calls += 1;
		if (calls < 3) {
			return { ok: false, status: 503, statusText: "boom", headers: new Map() };
		}
		return { ok: true, arrayBuffer: async () => body };
	};
	const noSleep = async () => {};
	const bytes = await fetchBytes("https://x/y", flaky, noSleep);
	assert.equal(calls, 3);
	assert.deepEqual(Array.from(bytes), [1, 2, 3]);
});

test("fetchBytes: a non-retryable status fails fast with the original error", async () => {
	let calls = 0;
	const gone = async () => {
		calls += 1;
		return { ok: false, status: 404, statusText: "nope", headers: new Map() };
	};
	await assert.rejects(
		() => fetchBytes("https://x/y", gone, async () => {}),
		/HTTP 404/,
	);
	assert.equal(calls, 1);
});

test("fetchBytes: an exhausted budget throws loudly", async () => {
	let calls = 0;
	const down = async () => {
		calls += 1;
		return { ok: false, status: 503, statusText: "down", headers: new Map() };
	};
	await assert.rejects(
		() => fetchBytes("https://x/y", down, async () => {}),
		new RegExp(`failed after ${MAX_ATTEMPTS} attempts`),
	);
	assert.equal(calls, MAX_ATTEMPTS);
});
