import { describe, expect, it } from "vitest";
import { chunkBytes } from "./fixtures";
import { IntegrityError } from "./integrity";
import { MemoryCacheStore } from "./memoryStore";

// A real chunk hash from examples/catalog (catalog_meta.json's single chunk).
const REAL_CHUNK =
	"baff671db712e38859be1046ef85ae0af6ba86bfa57fe01a69a3d42bcbe7fdda";

describe("MemoryCacheStore content-address integrity", () => {
	it("ingests a real chunk under its true hash and reads it back", async () => {
		const store = new MemoryCacheStore();
		expect(await store.hasChunk(REAL_CHUNK)).toBe(false);
		await store.putChunkCompressed(REAL_CHUNK, chunkBytes(REAL_CHUNK));
		expect(await store.hasChunk(REAL_CHUNK)).toBe(true);
		const plaintext = await store.getChunk(REAL_CHUNK);
		expect(plaintext.byteLength).toBeGreaterThan(0);
	});

	it("rejects a chunk stored under the wrong hash (fail-closed)", async () => {
		const store = new MemoryCacheStore();
		const wrongHash = "0".repeat(64);
		await expect(
			store.putChunkCompressed(wrongHash, chunkBytes(REAL_CHUNK)),
		).rejects.toBeInstanceOf(IntegrityError);
		expect(await store.hasChunk(wrongHash)).toBe(false);
	});

	it("rejects non-zstd bytes (decompress failure is an IntegrityError)", async () => {
		const store = new MemoryCacheStore();
		await expect(
			store.putChunkCompressed(REAL_CHUNK, new Uint8Array([1, 2, 3, 4])),
		).rejects.toBeInstanceOf(IntegrityError);
	});

	it("round-trips a manifest and reads the active pointer", async () => {
		const store = new MemoryCacheStore();
		const bytes = new TextEncoder().encode(
			'{"manifest_hash":"h","version":"v1"}',
		);
		const hash = await store.putManifest(bytes);
		expect(await store.getManifest(hash)).toEqual(bytes);
		expect(await store.readActive()).toBeNull();
		await store.promote({ manifest_hash: "h", version: "v1", signature: "s" });
		expect((await store.readActive())?.version).toBe("v1");
	});
});
