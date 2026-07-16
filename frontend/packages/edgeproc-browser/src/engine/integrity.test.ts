import { describe, expect, it } from "vitest";
import {
	catalogMetaChunkHash,
	catalogMetaChunkSize,
	chunkBytes,
} from "./fixtures";
import {
	decompressAndVerify,
	IntegrityError,
	verifyPlaintext,
} from "./integrity";

const REAL_CHUNK = catalogMetaChunkHash();
const REAL_CHUNK_SIZE = catalogMetaChunkSize();

describe("decompressAndVerify fail-closed size checks", () => {
	it("rejects a negative signed decompressed size before invoking zstd", async () => {
		await expect(
			decompressAndVerify(REAL_CHUNK, chunkBytes(REAL_CHUNK), -1),
		).rejects.toBeInstanceOf(IntegrityError);
	});

	it("rejects a signed size that differs from the decompressed frame", async () => {
		await expect(
			decompressAndVerify(
				REAL_CHUNK,
				chunkBytes(REAL_CHUNK),
				REAL_CHUNK_SIZE + 1,
			),
		).rejects.toBeInstanceOf(IntegrityError);
	});

	it("rejects plaintext under a different content address", async () => {
		await expect(
			verifyPlaintext("0".repeat(64), new Uint8Array([1])),
		).rejects.toBeInstanceOf(IntegrityError);
	});
});
