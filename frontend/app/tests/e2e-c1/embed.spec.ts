import { expect, test } from "@playwright/test";

/**
 * C1 — the in-browser query embedder, proven in a REAL browser with the REAL
 * model over onnxruntime-web WASM. This is the riskiest dependency edge: the
 * Node parity test proves transformers.js v4 + MiniLM at cosine 1.0, but only
 * via the Node ONNX backend. This spec guards the BROWSER WASM path: it loads
 * the actual ~25 MB model in headless Chromium and asserts the output is a
 * finite, L2-normalized 384-d vector.
 */

const EXPECTED_DIM = 384;

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

	// Model download + WASM compile happens on first embed; give it room.
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

	expect(errors, `in-browser errors:\n${errors.join("\n")}`).toEqual([]);
});
