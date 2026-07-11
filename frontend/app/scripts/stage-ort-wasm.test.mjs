// Preflight regression suite for the ORT wasm runtime staging
// (stage-ort-wasm.mjs). Offline by construction: everything resolves from the
// lockfile-pinned node_modules — no network.

import assert from "node:assert/strict";
import { readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	ORT_RUNTIME_FILES,
	ortDistDir,
	stageOrtWasm,
} from "./stage-ort-wasm.mjs";

test("the staged set is exactly the asyncify loader + wasm pair", () => {
	assert.deepEqual(ORT_RUNTIME_FILES, [
		"ort-wasm-simd-threaded.asyncify.mjs",
		"ort-wasm-simd-threaded.asyncify.wasm",
	]);
});

test("the lockfile-pinned onnxruntime-web ships both runtime files", async () => {
	const dist = ortDistDir();
	for (const file of ORT_RUNTIME_FILES) {
		const info = await stat(join(dist, file));
		assert.ok(info.size > 0, `${file} is empty`);
	}
});

test("every staged file fits under the Cloudflare Pages 25 MiB asset limit", async () => {
	// Same deploy constraint as the model weights: Pages rejects any single
	// asset over 25 MiB. An onnxruntime-web bump that outgrows it fails HERE.
	const dist = ortDistDir();
	const limit = 25 * 1024 * 1024;
	for (const file of ORT_RUNTIME_FILES) {
		const info = await stat(join(dist, file));
		assert.ok(
			info.size < limit,
			`${file} (${info.size} B) exceeds the Pages limit (${limit} B)`,
		);
	}
});

test("stageOrtWasm copies the pair byte-identically", async () => {
	const dest = join(tmpdir(), `ort-stage-test-${process.pid}`);
	try {
		await stageOrtWasm(dest);
		const dist = ortDistDir();
		for (const file of ORT_RUNTIME_FILES) {
			const [got, want] = await Promise.all([
				readFile(join(dest, file)),
				readFile(join(dist, file)),
			]);
			assert.ok(got.equals(want), `${file} differs from node_modules`);
		}
	} finally {
		await rm(dest, { recursive: true, force: true });
	}
});

test("stageOrtWasm fails loudly when a source file is missing", async () => {
	const dest = join(tmpdir(), `ort-stage-test-missing-${process.pid}`);
	try {
		await assert.rejects(
			() => stageOrtWasm(dest, join(tmpdir(), "definitely-not-ort-dist")),
			/ENOENT/,
		);
	} finally {
		await rm(dest, { recursive: true, force: true });
	}
});
