import { expect, test } from "@playwright/test";

/**
 * C1 — the in-browser query embedder, proven in a REAL browser with the REAL
 * model over onnxruntime-web WASM. This is the riskiest dependency edge: the
 * Node parity test proves transformers.js v4 + MiniLM at cosine 1.0, but only
 * via the Node ONNX backend. This spec guards the BROWSER WASM path: it loads
 * the actual ~23 MB model in headless Chromium and asserts the output is a
 * finite, L2-normalized 384-d vector.
 *
 * SELF-HOSTED (house standard §8.1b): the weights are served same-origin from
 * /models/ (materialized by scripts/download-model.mjs — the test:e2e:c1 script
 * runs it before Playwright). Every HuggingFace host is BLOCKED here and the
 * spec asserts the runtime never even tried to reach one; the production-build
 * equivalent (minified + service worker + jsDelivr also blocked) lives in
 * tests/e2e-offline/cold-blocked.spec.ts.
 */

const EXPECTED_DIM = 384;

/** Hosts transformers.js could reach for weights — the HF hub and its LFS CDN. */
const HF_GLOBS = ["**huggingface.co/**", "**cdn-lfs**", "**hf.co/**"];

declare global {
	interface Window {
		__embed?: (text: string) => Promise<number[]>;
		__embeddingDim?: number;
	}
}

test("loads the real MiniLM model in-browser (WASM) and embeds a normalized 384-d vector", async ({
	page,
}) => {
	// Surface in-browser failures (ort wasm errors, 404 on weights) clearly.
	const errors: string[] = [];
	page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
	page.on("console", (msg) => {
		if (msg.type() === "error") {
			errors.push(`console.error: ${msg.text()}`);
		}
	});

	// Abort every request to the HF hub / its LFS CDN, and record that the
	// runtime never even tried to reach it — /models/ must be the only source.
	let hitHf = 0;
	for (const glob of HF_GLOBS) {
		await page.route(glob, (route) => {
			hitHf += 1;
			return route.abort();
		});
	}

	// Model load + WASM compile happens on first embed; give it room.
	test.setTimeout(180_000);

	await page.goto("/embed-harness.html");
	await expect(page.locator("#status")).toHaveText("embedder-ready");

	const dim = await page.evaluate(() => window.__embeddingDim);
	expect(dim).toBe(EXPECTED_DIM);

	const vector = await page.evaluate(() =>
		window.__embed?.("moisture wicking golf polo"),
	);

	expect(vector, "embed() returned undefined").toBeDefined();
	const result = vector ?? [];

	// 1. exactly 384 dimensions
	expect(result.length).toBe(EXPECTED_DIM);

	// 2. every entry is a finite number
	const allFinite = result.every((x) => Number.isFinite(x));
	expect(allFinite, "vector contains non-finite values").toBe(true);

	// 3. L2 norm ≈ 1.0 (normalize: true)
	const norm = Math.sqrt(result.reduce((acc, x) => acc + x * x, 0));
	console.log(`measured: length=${result.length} L2-norm=${norm.toFixed(6)}`);
	expect(norm).toBeCloseTo(1.0, 2);

	// The runtime never depended on huggingface.co: the model came from /models/.
	expect(hitHf, "the runtime hit a blocked HF host").toBe(0);

	expect(errors, `in-browser errors:\n${errors.join("\n")}`).toEqual([]);
});
