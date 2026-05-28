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
import { createEmbedder } from "./embedder";

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
