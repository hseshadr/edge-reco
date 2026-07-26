import { Zstd } from "@hpcc-js/wasm-zstd";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./crypto";
import {
	catalogMetaChunkHash,
	catalogMetaChunkSize,
	chunkBytes,
	signedChunkRefs,
} from "./fixtures";
import { declaredContentSize, decompress, decompressBounded } from "./zstd";

// A real chunk hash from examples/catalog (catalog_meta.json's single chunk),
// derived from the manifest so it survives every catalog rebuild.
const REAL_CHUNK = catalogMetaChunkHash();
const REAL_CHUNK_SIZE = catalogMetaChunkSize();

/** Build a synthetic frame header so every Frame_Header_Descriptor branch is
 * reachable (an 8-byte Frame_Content_Size needs a >4 GiB payload in practice). */
function header(descriptor: number, tail: readonly number[]): Uint8Array {
	return new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, descriptor, ...tail]);
}

let zstd: Awaited<ReturnType<typeof Zstd.load>>;

beforeAll(async () => {
	zstd = await Zstd.load();
});

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

describe("decompressBounded", () => {
	it("decompresses a real catalog chunk at its signed size", async () => {
		const plaintext = await decompressBounded(
			chunkBytes(REAL_CHUNK),
			REAL_CHUNK_SIZE,
		);
		expect(plaintext.byteLength).toBe(REAL_CHUNK_SIZE);
		expect(await sha256Hex(plaintext)).toBe(REAL_CHUNK);
	});

	// The pre-decode guard is only safe to ship if EVERY chunk the Python
	// producer writes declares its size. Checked against the whole committed
	// bundle, not one sample, so a producer that ever switched to streaming
	// compression (which omits the declaration) would turn this red.
	it("holds for every chunk in the committed signed bundle", () => {
		const mismatches = signedChunkRefs().filter(
			(ref) => declaredContentSize(chunkBytes(ref.hash)) !== ref.size,
		);
		expect(signedChunkRefs().length).toBeGreaterThan(100);
		expect(mismatches).toEqual([]);
	});

	// A zstd bomb: a tiny frame whose header claims a huge payload. The guard
	// must reject it from the header alone, before the decoder ever runs.
	it("rejects a frame declaring more than its signed size, before decoding", async () => {
		const bomb = zstd.compress(new Uint8Array(4 * 1024 * 1024));
		expect(bomb.byteLength).toBeLessThan(1024);
		expect(declaredContentSize(bomb)).toBe(4 * 1024 * 1024);
		await expect(decompressBounded(bomb, 64)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
	});

	// The header still matches, so this exercises decompressEnd() — the
	// truncation check that replaced the old trailing-output probe.
	it("rejects a truncated frame whose header still matches", async () => {
		const full = chunkBytes(REAL_CHUNK);
		const truncated = full.subarray(0, full.byteLength - 8);
		expect(declaredContentSize(truncated)).toBe(REAL_CHUNK_SIZE);
		await expect(
			decompressBounded(truncated, REAL_CHUNK_SIZE),
		).rejects.toThrow();
	});

	// A truncated EMPTY frame declares 0 bytes and yields 0 bytes, so both the
	// header guard and the output-length gate are satisfied — only
	// decompressEnd() sees that the frame never completed.
	it("rejects a truncated frame that the length gate cannot catch", async () => {
		const truncatedEmpty = zstd.compress(new Uint8Array(0)).subarray(0, 8);
		expect(declaredContentSize(truncatedEmpty)).toBe(0);
		await expect(decompressBounded(truncatedEmpty, 0)).rejects.toThrow(
			"truncated Zstandard input",
		);
	});

	it("rejects a streamed frame that declares no size", async () => {
		zstd.resetCompression();
		const body = zstd.compressChunk(new Uint8Array(600).fill(7));
		const tail = zstd.compressEnd();
		const streamed = new Uint8Array(body.byteLength + tail.byteLength);
		streamed.set(body);
		streamed.set(tail, body.byteLength);
		expect(declaredContentSize(streamed)).toBeNull();
		await expect(decompressBounded(streamed, 600)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
	});

	// Frames appended after the signed one: the header guard only sees frame 1
	// and the decoder completes every frame it is fed, so the output-length gate
	// is what fails this closed.
	it("rejects extra frames appended after the signed one", async () => {
		const signed = chunkBytes(REAL_CHUNK);
		const extra = zstd.compress(new Uint8Array(16).fill(3));
		const appended = new Uint8Array(signed.byteLength + extra.byteLength);
		appended.set(signed);
		appended.set(extra, signed.byteLength);
		expect(declaredContentSize(appended)).toBe(REAL_CHUNK_SIZE);
		await expect(decompressBounded(appended, REAL_CHUNK_SIZE)).rejects.toThrow(
			"zstd output does not match its signed size",
		);
	});

	it("rejects bytes that are not a zstd frame", async () => {
		await expect(
			decompressBounded(new Uint8Array(32).fill(9), 32),
		).rejects.toThrow("zstd frame does not declare its signed size");
	});

	it("decompresses two different chunks in sequence (decoder state is reset)", async () => {
		const [first, second] = signedChunkRefs().slice(0, 2);
		if (first === undefined || second === undefined) {
			throw new Error("bundle fixture needs at least two chunks");
		}
		expect(
			(await decompressBounded(chunkBytes(first.hash), first.size)).byteLength,
		).toBe(first.size);
		expect(
			(await decompressBounded(chunkBytes(second.hash), second.size))
				.byteLength,
		).toBe(second.size);
	});
});

describe("declaredContentSize frame-header parsing", () => {
	it("reads the 1-, 2- and 4-byte Frame_Content_Size forms", () => {
		expect(declaredContentSize(zstd.compress(new Uint8Array(10)))).toBe(10);
		expect(declaredContentSize(zstd.compress(new Uint8Array(1000)))).toBe(1000);
		expect(declaredContentSize(zstd.compress(new Uint8Array(100_000)))).toBe(
			100_000,
		);
	});

	it("reads the 8-byte form", () => {
		// 0b1110_0000: FCS flag 3 (8 bytes), single segment, no dictionary.
		expect(declaredContentSize(header(0xe0, [2, 1, 0, 0, 0, 0, 0, 0]))).toBe(
			258,
		);
	});

	it("skips the window descriptor and dictionary id", () => {
		// 0b0110_0011: FCS flag 1 (2 bytes), single segment, 4-byte dictionary id.
		expect(declaredContentSize(header(0x63, [1, 2, 3, 4, 0, 0]))).toBe(256);
		// 0b0100_0001: FCS flag 1, NOT single segment (1-byte window descriptor),
		// 1-byte dictionary id.
		expect(declaredContentSize(header(0x41, [0x40, 7, 0, 0]))).toBe(256);
	});

	it("returns null when the frame declares nothing or is malformed", () => {
		// FCS flag 0 without the single-segment bit: no declaration at all.
		expect(declaredContentSize(header(0x00, [0x40, 0, 0]))).toBeNull();
		// Bit 3 (reserved) and bit 4 (unused) must both be zero.
		expect(declaredContentSize(header(0x08, [0, 0, 0, 0]))).toBeNull();
		expect(declaredContentSize(header(0x10, [0, 0, 0, 0]))).toBeNull();
		// FCS flag 2 (4 bytes) but the field is cut short.
		expect(declaredContentSize(header(0xa0, [1, 0]))).toBeNull();
		// Wrong magic number, and too short to hold any declaration.
		expect(declaredContentSize(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
		expect(declaredContentSize(new Uint8Array([0x28, 0xb5]))).toBeNull();
	});
});
