import { describe, expect, it } from "vitest";
import { sha256Hex } from "./crypto";
import { catalogMetaChunkHash, chunkBytes } from "./fixtures";
import { decompress } from "./zstd";

// A real chunk hash from examples/catalog (catalog_meta.json's single chunk),
// derived from the manifest so it survives every catalog rebuild.
const REAL_CHUNK = catalogMetaChunkHash();

describe("zstd decompress", () => {
	it("decompresses a real catalog chunk whose plaintext sha256 matches its name", async () => {
		const plaintext = await decompress(chunkBytes(REAL_CHUNK));
		expect(await sha256Hex(plaintext)).toBe(REAL_CHUNK);
	});

	it("round-trips a real chunk to valid JSON (catalog_meta.json)", async () => {
		const plaintext = await decompress(chunkBytes(REAL_CHUNK));
		const meta = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
			string,
			unknown
		>;
		expect(typeof meta).toBe("object");
	});
});
