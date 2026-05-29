// The data layer is now backend-free: every call runs the in-browser engine over
// the synced bundle, and sendEvent folds clicks into the in-tab session profile
// (no network) so the next recommend() re-ranks. These tests bootstrap the client
// against the REAL committed bundle via an injected fake sync-Worker + a stub
// embedder, then assert the contract shapes and the live re-rank loop in Node.

import {
	EMBEDDING_DIM,
	type Embedder,
	type EnginePort,
	type SyncResult,
} from "@edgeproc/browser";
import {
	type IndexManifest,
	MemoryCacheStore,
	materializeFile,
	syncIndex,
	type Verify,
} from "@edgeproc/browser/testing";
import { catalogFetch } from "@edgeproc/browser/testing/fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	__setRuntimeForTests,
	bootstrap,
	browse,
	catalogInfo,
	recommend,
	search,
	sendEvent,
} from "./client";
import type { Product } from "./types";

const acceptVerify: Verify = () => Promise.resolve();
const DECODER = new TextDecoder();

/** A fake sync Worker backed by the real committed bundle (no network, no OPFS). */
function fakeEnginePort(): EnginePort {
	const store = new MemoryCacheStore();
	const { fetchBytes } = catalogFetch();
	let manifest: IndexManifest | null = null;
	return {
		async sync(): Promise<SyncResult> {
			const result = await syncIndex({
				baseUrl: "/cat",
				store,
				fetchBytes,
				verify: acceptVerify,
			});
			manifest = JSON.parse(
				DECODER.decode(await store.getManifest(result.manifestHash)),
			) as IndexManifest;
			return result;
		},
		readFile(path: string): Promise<Uint8Array> {
			if (manifest === null) {
				throw new Error("sync first");
			}
			return materializeFile(store, manifest, path);
		},
	};
}

// A unit query vector — the embedder is unused for the contract assertions, but
// search() must get a valid 384-d vector to run the vector leg.
const stubEmbedder: Embedder = {
	embed(): Promise<Float32Array> {
		const v = new Float32Array(EMBEDDING_DIM);
		v[0] = 1;
		return Promise.resolve(v);
	},
};

describe("backend-free data layer", () => {
	beforeEach(async () => {
		__setRuntimeForTests({
			spawnEngine: () => fakeEnginePort(),
			makeEmbedder: () => stubEmbedder,
		});
		await bootstrap();
	});

	afterEach(() => {
		__setRuntimeForTests({
			spawnEngine: () => fakeEnginePort(),
			makeEmbedder: () => stubEmbedder,
		});
	});

	it("bootstrap reports stages ending in 'ready'", async () => {
		__setRuntimeForTests({
			spawnEngine: () => fakeEnginePort(),
			makeEmbedder: () => stubEmbedder,
		});
		const stages: string[] = [];
		await bootstrap((stage) => stages.push(stage.kind));
		expect(stages[0]).toBe("syncing");
		expect(stages.at(-1)).toBe("ready");
	});

	it("search() returns the SearchResponse shape from the engine", async () => {
		const res = await search("headphones", { limit: 5 });
		expect(res.query).toBe("headphones");
		expect(Array.isArray(res.results)).toBe(true);
		expect(res.results.length).toBeLessThanOrEqual(5);
		expect(typeof res.total).toBe("number");
	});

	it("browse() lists products with categories", async () => {
		const res = await browse({ limit: 8 });
		expect(res.products).toHaveLength(8);
		expect(res.categories.length).toBeGreaterThan(0);
	});

	it("catalogInfo() reports the catalog size", async () => {
		const info = await catalogInfo();
		expect(info.count).toBe((await browse({ limit: 10_000 })).total);
	});

	it("a click folds into the profile and re-ranks the next recommend (no network)", async () => {
		const cold = await recommend(10);
		expect(cold.session_clicks).toBe(0);
		const coldOrder = cold.results.map((r) => r.product.id).join(",");

		// Click 3 products in one category — clicks update the IN-TAB profile only.
		const target = cold.results[0]?.product as Product;
		const sameCategory = (await browse({ limit: 10_000 })).products
			.filter((p) => p.category === target.category)
			.slice(0, 3);
		for (const product of sameCategory) {
			await sendEvent({
				event_type: "click",
				product_id: product.id,
				timestamp: new Date().toISOString(),
			});
		}

		const warm = await recommend(10);
		expect(warm.session_clicks).toBe(3);
		const warmOrder = warm.results.map((r) => r.product.id).join(",");
		expect(warmOrder).not.toBe(coldOrder);
	});

	it("ignores clicks on unknown product ids", async () => {
		await sendEvent({
			event_type: "click",
			product_id: "does-not-exist",
			timestamp: new Date().toISOString(),
		});
		const res = await recommend(5);
		expect(res.session_clicks).toBe(0);
	});
});
