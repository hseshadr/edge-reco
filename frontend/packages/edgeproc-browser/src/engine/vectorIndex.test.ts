import { describe, expect, it } from "vitest";
import { catalogFetch, latestBytes } from "./fixtures";
import { MemoryCacheStore } from "./memoryStore";
import { materializeFile, syncIndex } from "./sync";
import type { IndexManifest, Verify, VersionPointer } from "./types";
import { loadVectorIndex, type VectorIndexFiles } from "./vectorIndex";

const acceptVerify: Verify = () => Promise.resolve();
const DECODER = new TextDecoder();

/** Sync the real bundle into memory and reassemble the four search inputs. */
async function syncedFiles(): Promise<VectorIndexFiles> {
	const store = new MemoryCacheStore();
	const { fetchBytes } = catalogFetch();
	const result = await syncIndex({
		baseUrl: "/cat",
		store,
		fetchBytes,
		verify: acceptVerify,
	});
	const pointer = JSON.parse(DECODER.decode(latestBytes())) as VersionPointer;
	const manifest = JSON.parse(
		DECODER.decode(await store.getManifest(result.manifestHash)),
	) as IndexManifest;
	void pointer;
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

function encoder(vectors: ReadonlyArray<ReadonlyArray<number>>): {
	readonly meta: Uint8Array;
	readonly state: Uint8Array;
	readonly embeddings: Uint8Array;
	readonly products: Uint8Array;
} {
	const dim = vectors[0]?.length ?? 0;
	const ids = vectors.map((_v, i) => `p${i}`);
	const flat = new Float32Array(vectors.flat());
	const products = ids
		.map((id) => JSON.stringify({ id, title: `title ${id}`, category: "c" }))
		.join("\n");
	const text = new TextEncoder();
	return {
		meta: text.encode(
			JSON.stringify({ embedding_count: vectors.length, embedding_dim: dim }),
		),
		state: text.encode(JSON.stringify({ faiss_ids: ids })),
		embeddings: new Uint8Array(flat.buffer),
		products: text.encode(products),
	};
}

describe("loadVectorIndex synthetic correctness", () => {
	it("cosine top-k ordering is exact over a known matrix", async () => {
		// Three orthonormal-ish rows; a query closest to row 1, then 2, then 0.
		const enc = encoder([
			[1, 0, 0],
			[0, 1, 0],
			[0.6, 0.8, 0],
		]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		// query points mostly along row 2's direction.
		const hits = index.search(new Float32Array([0.6, 0.8, 0]), 3);
		expect(hits.map((h) => h.id)).toEqual(["p2", "p1", "p0"]);
		// row 2 is identical to the (normalized) query -> cosine == 1.
		expect(hits[0]?.score).toBeCloseTo(1, 5);
	});

	it("normalizes a non-unit query vector before scoring", async () => {
		const enc = encoder([
			[1, 0],
			[0, 1],
		]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		// scaling the query must not change ordering or the cosine score.
		const small = index.search(new Float32Array([3, 0]), 1);
		expect(small[0]?.id).toBe("p0");
		expect(small[0]?.score).toBeCloseTo(1, 5);
	});

	it("k larger than ntotal returns every row", async () => {
		const enc = encoder([
			[1, 0],
			[0, 1],
		]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		expect(index.search(new Float32Array([1, 0]), 99)).toHaveLength(2);
		expect(index.ntotal).toBe(2);
	});

	it("exposes the product map keyed by id", async () => {
		const enc = encoder([[1, 0]]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		expect(index.product("p0")?.title).toBe("title p0");
		expect(index.product("missing")).toBeUndefined();
	});
});

describe("loadVectorIndex over the real synced bundle", () => {
	it("reports the real ntotal/dim and reads vectors row<->faiss_id aligned", async () => {
		const files = await syncedFiles();
		// Cross-check the loaded FAISS index against the bundle's own declaration
		// (catalog_meta.json) rather than hardcoding a count that drifts on rebuild.
		const meta = JSON.parse(DECODER.decode(files.meta)) as {
			readonly embedding_count: number;
			readonly embedding_dim: number;
		};
		const index = await loadVectorIndex(files);
		expect(index.ntotal).toBe(meta.embedding_count);
		expect(index.dim).toBe(meta.embedding_dim);
		// every stored row is L2-normalized -> a row queried against itself scores ~1.
		const self = index.rowVector(0);
		const hits = index.search(self, 1);
		expect(hits[0]?.id).toBe(index.idAt(0));
		expect(hits[0]?.score).toBeCloseTo(1, 4);
	});
});

describe("VectorIndex.nearest (kNN-to-seed primitive)", () => {
	it("excludes the seed and returns descending cosine neighbors", async () => {
		// A query closest to row 1, then 2, then 0; nearest(seed=p1) drops p1 itself
		// and returns its neighbors p2 (cosine ~0.8) then p0 (cosine 0), descending.
		const enc = encoder([
			[1, 0, 0],
			[0, 1, 0],
			[0.6, 0.8, 0],
		]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		const hits = index.nearest("p1", 2);
		expect(hits.map((h) => h.id)).toEqual(["p2", "p0"]);
		expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Number.NaN);
	});

	it("throws on an unknown seed id", async () => {
		const enc = encoder([[1, 0]]);
		const index = await loadVectorIndex({
			meta: enc.meta,
			state: enc.state,
			embeddings: enc.embeddings,
			products: enc.products,
		});
		expect(() => index.nearest("missing", 5)).toThrow(/unknown product id/);
	});

	it("over the real bundle: seed excluded, k results, strictly descending", async () => {
		const files = await syncedFiles();
		const index = await loadVectorIndex(files);
		const seed = "B07FPCD8BM";
		const hits = index.nearest(seed, 10);
		expect(hits).toHaveLength(10);
		expect(hits.some((h) => h.id === seed)).toBe(false);
		for (let i = 1; i < hits.length; i += 1) {
			expect(hits[i - 1]?.score).toBeGreaterThanOrEqual(
				hits[i]?.score ?? Number.NaN,
			);
		}
		// cosine to a unit seed lives in [-1, 1].
		for (const hit of hits) {
			expect(hit.score).toBeLessThanOrEqual(1 + 1e-5);
			expect(hit.score).toBeGreaterThanOrEqual(-1 - 1e-5);
		}
	});
});
