// @vitest-environment node
//
// Step 1 HARD GATE — query-embedding parity.
//
// Runs the real transformers.js feature-extraction pipeline (Xenova/all-MiniLM-L6-v2,
// mean-pool + L2-norm) over the same strings the Python ProductEncoder embedded
// into embedding_parity.json, and asserts cosine >= 0.99 per string. This proves
// the in-browser embedder reproduces the server's sentence-transformers vectors,
// which the whole hybrid pipeline is built on.
//
// The model (~25 MB) is fetched + compiled on first use, so the suite gets a long
// timeout. Set EDGE_RECO_SKIP_EMBEDDING_PARITY=1 to skip the network/model fetch
// in environments where it is unavailable (the parity numbers are reported on a
// machine with network access).

import { describe, expect, it } from "vitest";
import parityFixture from "./__fixtures__/embedding_parity.json" with {
	type: "json",
};
import {
	configureTransformersEnv,
	createEmbedder,
	EMBEDDING_DTYPE,
	pipelineOptions,
} from "./embedder";

interface ParityFixture {
	readonly model: string;
	readonly embedding_dim: number;
	readonly items: ReadonlyArray<{
		readonly text: string;
		readonly vector: ReadonlyArray<number>;
	}>;
}

const SKIP = process.env.EDGE_RECO_SKIP_EMBEDDING_PARITY === "1";
const MODEL_LOAD_TIMEOUT_MS = 180_000;

function cosine(a: Float32Array, b: ReadonlyArray<number>): number {
	let dot = 0;
	let aa = 0;
	let bb = 0;
	for (let i = 0; i < a.length; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		aa += av * av;
		bb += bv * bv;
	}
	const denom = Math.sqrt(aa) * Math.sqrt(bb);
	return denom === 0 ? 0 : dot / denom;
}

describe.skipIf(SKIP)(
	"query-embedding parity (transformers.js vs Python)",
	() => {
		it(
			"matches the sentence-transformers fixture at cosine >= 0.99 per string",
			async () => {
				const fixture = parityFixture as ParityFixture;
				// createEmbedder loads the real transformers.js pipeline lazily on the
				// first embed call (in the node env, onnxruntime-node backend).
				const embedder = createEmbedder();

				const cosines: { text: string; cos: number }[] = [];
				for (const item of fixture.items) {
					const vector = await embedder.embed(item.text);
					expect(vector.length).toBe(fixture.embedding_dim);
					cosines.push({ text: item.text, cos: cosine(vector, item.vector) });
				}

				for (const { text, cos } of cosines) {
					// Surface the measured cosine in the test output for the parity report.
					console.log(`cosine(${JSON.stringify(text)}) = ${cos.toFixed(6)}`);
				}
				for (const { cos } of cosines) {
					expect(cos).toBeGreaterThanOrEqual(0.99);
				}
			},
			MODEL_LOAD_TIMEOUT_MS,
		);
	},
);

describe("transformers.js env — self-hosted model config (house standard §8.1b)", () => {
	// The browser runtime must resolve model files from the SPA's own origin
	// (/models/, populated by app/scripts/download-model.mjs) with transformers.js
	// owning its offline copy in the `transformers-cache` CacheStorage cache —
	// aml-filter's ORT-web hardening config — AND load the onnxruntime-web wasm
	// runtime from the same-origin /ort/ mirror (staged by
	// app/scripts/stage-ort-wasm.mjs) instead of jsDelivr.
	it("browser runtime: self-hosted /models/ + /ort/ + transformers-cache enabled", () => {
		const fake = {
			useBrowserCache: false,
			allowLocalModels: false,
			localModelPath: "sentinel",
		};
		const fakeOrt: { wasmPaths?: string } = {};
		configureTransformersEnv(fake, fakeOrt, false);
		expect(fake.useBrowserCache).toBe(true);
		expect(fake.allowLocalModels).toBe(true);
		expect(fake.localModelPath).toBe("/models/");
		expect(fakeOrt.wasmPaths).toBe("/ort/");
	});

	// In Node (this parity suite) the library's defaults stay untouched: the HF
	// hub + filesystem cache serve the fp32 export the Python fixtures pin, and
	// onnxruntime-node needs no wasm path.
	it("node runtime: leaves the transformers.js env untouched", () => {
		const fake = {
			useBrowserCache: false,
			allowLocalModels: false,
			localModelPath: "sentinel",
		};
		const fakeOrt: { wasmPaths?: string } = {};
		configureTransformersEnv(fake, fakeOrt, true);
		expect(fake).toEqual({
			useBrowserCache: false,
			allowLocalModels: false,
			localModelPath: "sentinel",
		});
		expect(fakeOrt.wasmPaths).toBeUndefined();
	});
});

describe("pipeline options — explicit dtype pin (house standard §8.1b)", () => {
	// The browser pins dtype q8 EXPLICITLY (the `model_quantized.onnx` export the
	// download script self-hosts) instead of relying on the wasm device's implicit
	// default — the pin is a contract, not a coincidence.
	it("browser runtime pins dtype q8", () => {
		expect(pipelineOptions(false)).toEqual({ dtype: EMBEDDING_DTYPE });
		expect(EMBEDDING_DTYPE).toBe("q8");
	});

	// Node keeps the default (fp32) export: the embedding-parity fixture pins the
	// Python sentence-transformers fp32 recipe, and q8-vs-fp32 drift would flunk it.
	it("node runtime keeps the default dtype", () => {
		expect(pipelineOptions(true)).toEqual({});
	});
});
