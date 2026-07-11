// Prebuild: self-host the onnxruntime-web wasm runtime so the browser never
// pulls it from jsDelivr at runtime (house standard §8.1b — zero runtime CDN).
//
// onnxruntime-web (pulled by @huggingface/transformers) dynamically imports its
// wasm LOADER MODULE at runtime — `ort-wasm-simd-threaded.asyncify.mjs`, which
// then fetches its sibling `.wasm` relative to its own URL — and the library's
// default base for that import is the jsDelivr CDN. The cold-CDN-blocked e2e
// caught exactly that: with jsDelivr aborted, the engine died with
// `no available backend found … Failed to fetch dynamically imported module`.
//
// The fix pair: `env.backends.onnx.wasm.wasmPaths = "/ort/"` (set in
// packages/edgeproc-browser/src/engine/embedder.ts) makes the runtime import
// same-origin, and THIS script materializes those files into app/public/ort/
// by copying them out of the LOCKFILE-PINNED node_modules copy of
// onnxruntime-web — the exact bytes pnpm resolved, no network, fully
// deterministic. Runs from the app's `prebuild` hook (and before the c1 e2e
// suite); the staged files are git-ignored like the model weights.
//
// Only the `asyncify` pair is staged: with no COOP/COEP (crossOriginIsolated
// is false on localhost previews AND on edge-reco.com), the wasm execution
// provider always selects the asyncify build. If onnxruntime-web ever asks for
// a different variant, the cold-blocked e2e fails loudly and this list grows.

import { copyFile, mkdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** The runtime files onnxruntime-web requests from `wasmPaths` at runtime. */
export const ORT_RUNTIME_FILES = Object.freeze([
	"ort-wasm-simd-threaded.asyncify.mjs",
	"ort-wasm-simd-threaded.asyncify.wasm",
]);

const here = dirname(fileURLToPath(import.meta.url));

/** Where the staged runtime lands: app/public/ort/<file>. */
export function ortDir() {
	return join(here, "..", "public", "ort");
}

/**
 * The dist/ directory of the onnxruntime-web copy the lockfile pinned.
 * Resolved THROUGH @huggingface/transformers (its direct dependent — pnpm's
 * strict layout hides transitive deps from the app itself) so the staged bytes
 * are exactly the ones the bundled transformers.js will request. Both packages
 * fence their `exports`, so the MAIN entry is resolved and the package root is
 * derived from its path.
 */
export function ortDistDir() {
	const req = createRequire(join(here, "..", "package.json"));
	const transformersMain = req.resolve("@huggingface/transformers");
	const ortMain = createRequire(transformersMain).resolve("onnxruntime-web");
	const marker = `${sep}node_modules${sep}onnxruntime-web${sep}`;
	const at = ortMain.lastIndexOf(marker);
	if (at === -1) {
		throw new Error(
			`cannot locate onnxruntime-web package root from ${ortMain}`,
		);
	}
	return join(ortMain.slice(0, at + marker.length), "dist");
}

/** Copy the runtime pair into `destDir`; fail loudly if a source is missing. */
export async function stageOrtWasm(destDir, srcDir) {
	const from = srcDir ?? ortDistDir();
	await mkdir(destDir, { recursive: true });
	for (const file of ORT_RUNTIME_FILES) {
		const src = join(from, file);
		const size = (await stat(src)).size; // throws loudly if absent
		await copyFile(src, join(destDir, file));
		console.log(`  stage  ${file} (${size} bytes, from node_modules)`);
	}
	console.log("ORT wasm runtime staged (same-origin, no runtime CDN).");
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
	stageOrtWasm(ortDir()).catch((err) => {
		console.error(`\nORT wasm staging FAILED: ${err.message}`);
		process.exit(1);
	});
}
