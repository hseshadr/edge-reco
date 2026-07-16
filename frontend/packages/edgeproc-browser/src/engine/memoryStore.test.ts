import { describe, expect, it } from "vitest";
import {
	catalogMetaChunkHash,
	catalogMetaChunkSize,
	chunkBytes,
} from "./fixtures";
import { IntegrityError } from "./integrity";
import { MemoryCacheStore } from "./memoryStore";

// A real chunk hash from examples/catalog (catalog_meta.json's single chunk),
// derived from the manifest so it survives every catalog rebuild.
const REAL_CHUNK = catalogMetaChunkHash();
const REAL_CHUNK_SIZE = catalogMetaChunkSize();

describe("MemoryCacheStore content-address integrity", () => {
	it("ingests a real chunk under its true hash and reads it back", async () => {
		const store = new MemoryCacheStore();
		expect(await store.hasChunk(REAL_CHUNK)).toBe(false);
		await store.putChunkCompressed(
			REAL_CHUNK,
			chunkBytes(REAL_CHUNK),
			REAL_CHUNK_SIZE,
		);
		expect(await store.hasChunk(REAL_CHUNK)).toBe(true);
		const plaintext = await store.getChunk(REAL_CHUNK, REAL_CHUNK_SIZE);
		expect(plaintext.byteLength).toBeGreaterThan(0);
	});

	it("rejects a chunk stored under the wrong hash (fail-closed)", async () => {
		const store = new MemoryCacheStore();
		const wrongHash = "0".repeat(64);
		await expect(
			store.putChunkCompressed(
				wrongHash,
				chunkBytes(REAL_CHUNK),
				REAL_CHUNK_SIZE,
			),
		).rejects.toBeInstanceOf(IntegrityError);
		expect(await store.hasChunk(wrongHash)).toBe(false);
	});

	it("rejects non-zstd bytes (decompress failure is an IntegrityError)", async () => {
		const store = new MemoryCacheStore();
		await expect(
			store.putChunkCompressed(
				REAL_CHUNK,
				new Uint8Array([1, 2, 3, 4]),
				REAL_CHUNK_SIZE,
			),
		).rejects.toBeInstanceOf(IntegrityError);
	});

	it("fails closed when a requested chunk is absent or has the wrong size", async () => {
		const store = new MemoryCacheStore();
		await expect(store.getChunk(REAL_CHUNK, REAL_CHUNK_SIZE)).rejects.toThrow(
			/not in store/iu,
		);
		await store.putChunkCompressed(
			REAL_CHUNK,
			chunkBytes(REAL_CHUNK),
			REAL_CHUNK_SIZE,
		);
		await expect(
			store.getChunk(REAL_CHUNK, REAL_CHUNK_SIZE + 1),
		).rejects.toThrow(/expected/iu);
	});

	it("round-trips a manifest and reads the active pointer", async () => {
		const store = new MemoryCacheStore();
		const bytes = new TextEncoder().encode(
			'{"manifest_hash":"h","version":"v1"}',
		);
		const hash = await store.putManifest(bytes);
		expect(await store.getManifest(hash)).toEqual(bytes);
		expect(await store.readActive()).toBeNull();
		await store.promote({
			manifest_hash: "h",
			version: "v1",
			sequence: 1,
			signature: "s",
		});
		expect((await store.readActive())?.version).toBe("v1");
		expect(() => store.getManifest("missing")).toThrow(/not in store/iu);
	});
});
