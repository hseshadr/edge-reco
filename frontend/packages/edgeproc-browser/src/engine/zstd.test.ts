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

/** Block_Header for a Last_Block RLE block carrying one byte:
 * Block_Size=1 (bits 23-3) | Block_Type=RLE(1) (bits 2-1) | Last_Block=1. */
const LAST_RLE_BLOCK = [(1 << 3) | (1 << 1) | 1, 0x00, 0x00, 0x00] as const;

/** A synthetic frame that SPANS its own bytes: {@link header} plus a terminating
 * RLE block. Header-only bytes are no longer a frame — the span check refuses
 * them — so descriptor-branch coverage needs a real Last_Block. */
function declaringFrame(
	descriptor: number,
	tail: readonly number[],
): Uint8Array {
	return new Uint8Array([...header(descriptor, tail), ...LAST_RLE_BLOCK]);
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.byteLength;
	}
	return out;
}

function repeat(frame: Uint8Array, times: number): Uint8Array {
	return concat(...Array.from({ length: times }, () => frame));
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

	// The frame HEADER still declares the signed size, so only the frame walk
	// can see that the blocks never reach a Last_Block. Rejected before the
	// decoder runs; `decompressEnd()`'s own truncation report is pinned in
	// zstd.decoderContract.test.ts, where the decoder can be made to lie.
	it("rejects a truncated frame whose header still matches", async () => {
		const full = chunkBytes(REAL_CHUNK);
		const truncated = full.subarray(0, full.byteLength - 8);
		expect(declaredContentSize(truncated)).toBeNull();
		await expect(decompressBounded(truncated, REAL_CHUNK_SIZE)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
	});

	// A truncated EMPTY frame declares 0 bytes and would yield 0 bytes, so both
	// the declaration check and the output-length gate are satisfied by it —
	// only the frame walk sees that the frame never completed.
	it("rejects a truncated frame that the length gate cannot catch", async () => {
		const empty = zstd.compress(new Uint8Array(0));
		expect(declaredContentSize(empty)).toBe(0);
		const truncatedEmpty = empty.subarray(0, empty.byteLength - 1);
		expect(declaredContentSize(truncatedEmpty)).toBeNull();
		await expect(decompressBounded(truncatedEmpty, 0)).rejects.toThrow(
			"zstd frame does not declare its signed size",
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

	// Frames appended after the signed one. The declaration check alone cannot
	// see them — frame 1 declares exactly the signed size — and the decoder
	// completes every frame it is fed, so this is refused only because the
	// signed frame must span the WHOLE input.
	it("rejects extra frames appended after the signed one", async () => {
		const signed = chunkBytes(REAL_CHUNK);
		const extra = zstd.compress(new Uint8Array(16).fill(3));
		const appended = new Uint8Array(signed.byteLength + extra.byteLength);
		appended.set(signed);
		appended.set(extra, signed.byteLength);
		expect(declaredContentSize(signed)).toBe(REAL_CHUNK_SIZE);
		expect(declaredContentSize(appended)).toBeNull();
		await expect(decompressBounded(appended, REAL_CHUNK_SIZE)).rejects.toThrow(
			"zstd frame does not declare its signed size",
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

// --- The multi-frame decompression bomb -------------------------------------
//
// `decompressChunk` decodes CONCATENATED frames in a single call, so a guard
// that inspects only the FIRST frame's declaration bounds nothing: every frame
// can declare exactly the signed size while the call as a whole emits their
// sum, and the output-length gate can only fire once that memory already exists.
//
// The measured shape: `Zstd.compress(new Uint8Array(4 MiB))` is 147 bytes and
// declares 4 MiB. 3566 of them pack into 512 KiB and decode to 14,956,888,064
// bytes — 3566x the size the signed manifest vouched for. These tests never
// decode that payload (it would exhaust the WASM heap); they prove the guard
// refuses it from the bytes alone, before any of it reaches the decoder.
describe("concatenated frames", () => {
	it("decodes every concatenated frame in a single decompressChunk call", () => {
		// The library behaviour the whole attack rests on, at a harmless scale.
		const one = zstd.compress(new Uint8Array(64 * 1024));
		zstd.resetDecompression();
		const output = zstd.decompressChunk(repeat(one, 8));
		zstd.decompressEnd();
		expect(output.byteLength).toBe(8 * 64 * 1024);
	});

	it("refuses 512 KiB of signed-size frames that would emit 14.9 GB", async () => {
		const signedSize = 4 * 1024 * 1024;
		const bomb = zstd.compress(new Uint8Array(signedSize));
		expect(bomb.byteLength).toBe(147);
		const repetitions = Math.floor((512 * 1024) / bomb.byteLength);
		expect(repetitions).toBe(3566);
		expect(repetitions * signedSize).toBe(14_956_888_064);

		const packed = repeat(bomb, repetitions);
		expect(packed.byteLength).toBeLessThanOrEqual(512 * 1024);
		// Frame 1 declares exactly the signed size, so a first-frame-only check
		// waves all 3566 frames through. The frame must span the WHOLE input.
		expect(declaredContentSize(packed)).toBeNull();
		await expect(decompressBounded(packed, signedSize)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
	});

	it("refuses concatenated frames whose total is under the signed size", async () => {
		// The single-frame binding in isolation: 8 KiB of output is well under the
		// 8 KiB signed size below, so neither the declaration check nor the
		// output-length gate can reject this — only "exactly one frame spanning
		// the input" can.
		const one = zstd.compress(new Uint8Array(1024));
		const eight = repeat(one, 8);
		expect(declaredContentSize(one)).toBe(1024);
		expect(declaredContentSize(eight)).toBeNull();
		await expect(decompressBounded(eight, 8 * 1024)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
	});

	it("refuses a single frame with even one trailing byte", async () => {
		const frame = chunkBytes(REAL_CHUNK);
		const trailing = concat(frame, new Uint8Array([0]));
		expect(declaredContentSize(trailing)).toBeNull();
		await expect(decompressBounded(trailing, REAL_CHUNK_SIZE)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
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
		expect(
			declaredContentSize(declaringFrame(0xe0, [2, 1, 0, 0, 0, 0, 0, 0])),
		).toBe(258);
	});

	it("skips the window descriptor and dictionary id", () => {
		// 0b0110_0011: FCS flag 1 (2 bytes), single segment, 4-byte dictionary id.
		expect(declaredContentSize(declaringFrame(0x63, [1, 2, 3, 4, 0, 0]))).toBe(
			256,
		);
		// 0b0100_0001: FCS flag 1, NOT single segment (1-byte window descriptor),
		// 1-byte dictionary id.
		expect(declaredContentSize(declaringFrame(0x41, [0x40, 7, 0, 0]))).toBe(
			256,
		);
	});

	// The frame walk is what makes the declaration binding. Each branch of it
	// must be able to say no, or the "exactly one frame" rule is decorative.
	it("returns null when the frame does not span its input", () => {
		// A header with no block at all: not a frame, however well-formed.
		expect(
			declaredContentSize(header(0xe0, [2, 1, 0, 0, 0, 0, 0, 0])),
		).toBeNull();
		// A Block_Header cut short.
		const frame = declaringFrame(0xa0, [64, 0, 0, 0]);
		expect(declaredContentSize(frame)).toBe(64);
		expect(
			declaredContentSize(frame.slice(0, frame.byteLength - 2)),
		).toBeNull();
		// A block whose declared Block_Size runs past the end.
		const overrun = declaringFrame(0xa0, [64, 0, 0, 0]);
		// Block_Size=64 (bits 23-3) | Block_Type=Raw(0) | Last_Block=1.
		overrun[9] = ((64 << 3) | 1) & 0xff;
		overrun[10] = ((64 << 3) | 1) >>> 8;
		expect(declaredContentSize(overrun)).toBeNull();
	});

	it("returns null for a reserved Block_Type", () => {
		const reserved = declaringFrame(0xa0, [64, 0, 0, 0]);
		// Block_Size=1 | Block_Type=3 (reserved) | Last_Block=1.
		reserved[9] = (1 << 3) | (3 << 1) | 1;
		expect(declaredContentSize(reserved)).toBeNull();
	});

	it("walks past a non-last block to the Last_Block", () => {
		// Two RLE blocks: the first is not the last, so the walk must continue.
		const twoBlocks = new Uint8Array([
			...header(0xa0, [64, 0, 0, 0]),
			(1 << 3) | (1 << 1), // Block_Size=1 | RLE | Last_Block=0
			0x00,
			0x00,
			0x00,
			...LAST_RLE_BLOCK,
		]);
		expect(declaredContentSize(twoBlocks)).toBe(64);
		expect(declaredContentSize(twoBlocks.slice(0, 13))).toBeNull();
	});

	it("accounts for the trailing Content_Checksum when one is present", () => {
		// Frames written with a content checksum carry 4 extra trailing bytes.
		// They belong to the frame, so the span check must expect them —
		// otherwise every checksummed chunk would look like trailing garbage.
		// 0b1010_0100: FCS flag 2 (4 bytes) | Single_Segment | Content_Checksum.
		const checksummed = new Uint8Array([
			...declaringFrame(0xa4, [64, 0, 0, 0]),
			0,
			0,
			0,
			0,
		]);
		expect(declaredContentSize(checksummed)).toBe(64);
		// Without the 4 checksum bytes the frame no longer spans the input.
		expect(
			declaredContentSize(checksummed.slice(0, checksummed.byteLength - 4)),
		).toBeNull();
	});

	// Each case below is a frame that SPANS its input, so the span check cannot
	// be what rejects it — the header rule under test is the only reason. (A
	// header-only fixture would be refused by the span walk regardless, which
	// would leave these rules unproven.)
	it("returns null when the frame declares nothing or is malformed", () => {
		// FCS flag 0 without the single-segment bit: no declaration at all.
		// Descriptor 0x00 keeps a 1-byte Window_Descriptor, so the body starts at 6.
		expect(declaredContentSize(declaringFrame(0x00, [0x40]))).toBeNull();
		// Bit 3 (reserved) and bit 4 (unused) must both be zero. 0xa0 alone is a
		// valid 4-byte-FCS single-segment frame declaring 64 (asserted above), so
		// setting either bit is the whole difference.
		expect(declaredContentSize(declaringFrame(0xa0, [64, 0, 0, 0]))).toBe(64);
		expect(declaredContentSize(declaringFrame(0xa8, [64, 0, 0, 0]))).toBeNull();
		expect(declaredContentSize(declaringFrame(0xb0, [64, 0, 0, 0]))).toBeNull();
		// FCS flag 2 (4 bytes) but the field is cut short: the frame ends inside
		// its own declaration, so there is nothing to read.
		expect(declaredContentSize(header(0xa0, [1, 0]))).toBeNull();
		// Wrong magic number, and too short to hold any declaration.
		expect(declaredContentSize(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull();
		expect(declaredContentSize(new Uint8Array([0x28, 0xb5]))).toBeNull();
		expect(declaredContentSize(new Uint8Array(0))).toBeNull();
	});
});
