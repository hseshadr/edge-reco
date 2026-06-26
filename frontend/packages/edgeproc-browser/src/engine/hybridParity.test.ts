// @vitest-environment node
//
// End-to-end hybrid-search parity: the full in-browser pipeline
// (transformers.js embed -> BM25 + vector cosine -> RRF -> empty-profile rerank)
// vs edge-reco's /search route over the same examples/catalog bundle. Proves the
// browser engine reproduces the server's top-k, not just the embedder.
//
// Runs in the node environment because the real transformers.js pipeline uses the
// onnxruntime-node backend, which rejects jsdom's patched Float32Array. The model
// (~25 MB) loads on first use, so the suite gets a long timeout. Skippable via
// EDGE_RECO_SKIP_EMBEDDING_PARITY=1 (the embedder is the gated part).

import { describe, expect, it } from "vitest";
import hybridFixture from "./__fixtures__/hybrid_parity.json" with {
	type: "json",
};
import { createEmbedder } from "./embedder";
import { catalogFetch } from "./fixtures";
import { MemoryCacheStore } from "./memoryStore";
import { createSearchEngine, type SearchEngine } from "./searchEngine";
import { materializeFile, syncIndex } from "./sync";
import type { IndexManifest, Verify } from "./types";
import type { VectorIndexFiles } from "./vectorIndex";

interface HybridFixture {
	readonly limit: number;
	readonly cases: ReadonlyArray<{
		readonly query: string;
		readonly total: number;
		readonly expected: ReadonlyArray<{
			readonly id: string;
			readonly score: number;
		}>;
	}>;
}

const SKIP = process.env.EDGE_RECO_SKIP_EMBEDDING_PARITY === "1";
const TIMEOUT_MS = 180_000;
const acceptVerify: Verify = () => Promise.resolve();
const DECODER = new TextDecoder();

async function syncedFiles(): Promise<VectorIndexFiles> {
	const store = new MemoryCacheStore();
	const { fetchBytes } = catalogFetch();
	const result = await syncIndex({
		baseUrl: "/cat",
		store,
		fetchBytes,
		verify: acceptVerify,
	});
	const manifest = JSON.parse(
		DECODER.decode(await store.getManifest(result.manifestHash)),
	) as IndexManifest;
	const read = (path: string): Promise<Uint8Array> =>
		materializeFile(store, manifest, path);
	const [meta, state, embeddings, products] = await Promise.all([
		read("catalog_meta.json"),
		read("vector/state.json"),
		read("vector/embeddings.f32"),
		read("products.jsonl"),
	]);
	return { meta, state, embeddings, products };
}

async function realEngine(): Promise<SearchEngine> {
	// createEmbedder loads the real transformers.js pipeline lazily (node env).
	return createSearchEngine(await syncedFiles(), createEmbedder());
}

/** Bucket an ordered (id, score) list into ids grouped by rounded score, so
 * equal-score ties (which order arbitrarily) are compared as sets, not by
 * position — the documented C2b tie-group tolerance. */
function scoreGroups(
	entries: ReadonlyArray<{ readonly id: string; readonly score: number }>,
): ReadonlyArray<ReadonlyArray<string>> {
	const groups: { score: string; ids: string[] }[] = [];
	for (const entry of entries) {
		const key = entry.score.toFixed(6);
		const last = groups.at(-1);
		if (last !== undefined && last.score === key) {
			last.ids.push(entry.id);
		} else {
			groups.push({ score: key, ids: [entry.id] });
		}
	}
	return groups.map((g) => g.ids.slice().sort());
}

describe.skipIf(SKIP)(
	"hybrid-search parity (TS engine vs edge-reco /search)",
	() => {
		it(
			"reproduces the backend top-k for each query string",
			async () => {
				const fixture = hybridFixture as HybridFixture;
				const engine = await realEngine();

				for (const testCase of fixture.cases) {
					const response = await engine.search(testCase.query, {
						limit: fixture.limit,
					});
					const actual = response.results.map((r) => ({
						id: r.product.id,
						score: r.score,
					}));
					// Top-k ids match by score group (ties may reorder within a group).
					expect(scoreGroups(actual)).toEqual(scoreGroups(testCase.expected));
					// Reranked scores match Python to float precision, in order.
					response.results.forEach((result, i) => {
						expect(result.score).toBeCloseTo(
							testCase.expected[i]?.score ?? 0,
							5,
						);
					});
					expect(response.total).toBe(testCase.total);
					expect(response.query).toBe(testCase.query);
					// The full hybrid path populates the per-signal breakdown.
					expect(response.results[0]?.score_components).not.toBeNull();
				}
			},
			TIMEOUT_MS,
		);
	},
);
