// One-shot zstd decompression of verbatim chunk bytes, via @hpcc-js/wasm-zstd.
// The producer serves the exact zstd file; the consumer decompresses without
// re-compressing (mirrors edge-proc's put_chunk_compressed ingest path).

import { Zstd } from "@hpcc-js/wasm-zstd";

let instance: Awaited<ReturnType<typeof Zstd.load>> | null = null;

async function load(): Promise<Awaited<ReturnType<typeof Zstd.load>>> {
	if (instance === null) {
		instance = await Zstd.load();
	}
	return instance;
}

// --- Zstandard frame parsing (RFC 8878 section 3.1.1) -----------------------
//
// We establish the output bound OURSELVES, before any byte reaches the decoder.
//
// Up to @hpcc-js/wasm-zstd 1.13.4 the bound was an argument:
//   decompressChunk(compressedData: Uint8Array, outputSize: number): Uint8Array
// WASM allocated exactly `outputSize`. 1.15.0 REMOVED that parameter, and JS
// silently drops extra arguments, so the old call still compiled and ran while
// enforcing nothing. `Zstd.decompress()` is strictly worse: it reads the frame's
// own declared size and allocates that — the attacker-controlled number.
//
// So the bound moves earlier, into the frame header. Two properties must hold
// before we decode, both cheap to check from ~6-14 header bytes plus a walk of
// the 3-byte block headers:
//
//   1. The input is EXACTLY ONE frame spanning every byte. `decompressChunk`
//      decodes concatenated frames in a single call, so checking only the first
//      frame's declaration is bypassable: 512 KiB of repeated 147-byte frames,
//      each declaring the signed 4 MiB, decodes to 14,956,888,064 bytes — and
//      the output-length gate can only fire once that memory already exists.
//   2. That frame DECLARES its Frame_Content_Size, and the declaration equals
//      the signed manifest's size. libzstd then refuses to emit more content
//      than the frame declared.
//
// Every chunk the Python producer writes is a single declaring frame, so this
// rejects nothing legitimate — see the bundle-wide test. See `decompressBounded`.

const ZSTD_MAGIC = 0xfd2f_b528;
/** Frame_Content_Size field width, indexed by Frame_Content_Size_flag. */
const FCS_FIELD_SIZES = [0, 2, 4, 8] as const;
/** Dictionary_ID field width, indexed by Dictionary_ID_flag. */
const DICTIONARY_ID_SIZES = [0, 1, 2, 4] as const;
/** Frame_Header_Descriptor bits 4 and 3 are "unused" and "reserved": both zero. */
const MUST_BE_ZERO_BITS = 0b0001_1000;
const SINGLE_SEGMENT_BIT = 0b0010_0000;
const CONTENT_CHECKSUM_BIT = 0b0000_0100;
/** Smallest frame that can carry a declaration: magic(4) + descriptor(1) + FCS(1). */
const MIN_DECLARING_FRAME_BYTES = 6;
const BLOCK_HEADER_BYTES = 3;
const CONTENT_CHECKSUM_BYTES = 4;
/** Block_Type sits in Block_Header bits 2-1. RLE blocks carry a single byte. */
const BLOCK_TYPE_RLE = 1;
const BLOCK_TYPE_RESERVED = 3;

/** A parsed Frame_Header: what it declares, and where its blocks begin. */
interface FrameHeader {
	/** Frame_Content_Size, or null when the frame declines to declare one. */
	readonly declaredSize: number | null;
	/** Offset of the first Block_Header. */
	readonly bodyOffset: number;
	readonly hasChecksum: boolean;
}

/** Read the little-endian FCS field. The 2-byte form stores `size - 256`. */
function readContentSize(
	view: DataView,
	offset: number,
	width: number,
): number {
	if (width === 1) {
		return view.getUint8(offset);
	}
	if (width === 2) {
		return view.getUint16(offset, true) + 256;
	}
	if (width === 4) {
		return view.getUint32(offset, true);
	}
	return Number(view.getBigUint64(offset, true));
}

/** Decode Magic_Number + Frame_Header. Null when the bytes are not a zstd frame. */
function parseFrameHeader(view: DataView): FrameHeader | null {
	if (view.byteLength < MIN_DECLARING_FRAME_BYTES) {
		return null;
	}
	if (view.getUint32(0, true) !== ZSTD_MAGIC) {
		return null;
	}
	const descriptor = view.getUint8(4);
	if ((descriptor & MUST_BE_ZERO_BITS) !== 0) {
		return null;
	}
	const singleSegment = (descriptor & SINGLE_SEGMENT_BIT) !== 0;
	const flag = descriptor >>> 6;
	// Flag 0 means "1 byte" for single-segment frames and "absent" otherwise.
	// Both lookups are in range (each index is masked to 0-3); `?? 0` only
	// satisfies noUncheckedIndexedAccess, and fails closed if that ever changes.
	const width =
		flag === 0 ? Number(singleSegment) : (FCS_FIELD_SIZES[flag] ?? 0);
	// magic(4) + descriptor(1) + Window_Descriptor(1, single-segment omits it).
	const offset =
		5 + Number(!singleSegment) + (DICTIONARY_ID_SIZES[descriptor & 0b11] ?? 0);
	if (view.byteLength < offset + width) {
		return null;
	}
	return {
		declaredSize: width === 0 ? null : readContentSize(view, offset, width),
		bodyOffset: offset + width,
		hasChecksum: (descriptor & CONTENT_CHECKSUM_BIT) !== 0,
	};
}

/** Total byte length of the frame, by walking Block_Headers from `bodyOffset`
 * to the Last_Block. Null when a block is malformed or runs past the end. */
function frameByteLength(view: DataView, header: FrameHeader): number | null {
	let at = header.bodyOffset;
	for (;;) {
		if (at + BLOCK_HEADER_BYTES > view.byteLength) {
			return null;
		}
		// Block_Header is a 24-bit little-endian value: bit 0 Last_Block,
		// bits 2-1 Block_Type, bits 23-3 Block_Size.
		const raw =
			view.getUint8(at) |
			(view.getUint8(at + 1) << 8) |
			(view.getUint8(at + 2) << 16);
		const blockType = (raw >>> 1) & 0b11;
		if (blockType === BLOCK_TYPE_RESERVED) {
			return null;
		}
		at += BLOCK_HEADER_BYTES + (blockType === BLOCK_TYPE_RLE ? 1 : raw >>> 3);
		if (at > view.byteLength) {
			return null;
		}
		if ((raw & 1) === 1) {
			return at + (header.hasChecksum ? CONTENT_CHECKSUM_BYTES : 0);
		}
	}
}

/**
 * The decompressed size that `bytes` bindingly declares, or `null` when no bound
 * can be established before decoding — because the bytes are not a zstd frame,
 * the frame omits its Frame_Content_Size, or the input is not exactly one frame
 * (trailing bytes or a second concatenated frame would decode unbounded).
 *
 * Exported for tests: every chunk the Python producer writes is one declaring
 * frame whose declaration is the size its signed manifest entry claims.
 */
export function declaredContentSize(bytes: Uint8Array): number | null {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const header = parseFrameHeader(view);
	if (header === null || header.declaredSize === null) {
		return null;
	}
	if (frameByteLength(view, header) !== bytes.byteLength) {
		return null;
	}
	return header.declaredSize;
}

/**
 * Decompress a single frame that must declare — and produce — exactly
 * `expectedSize`.
 *
 * The bound is applied BEFORE the decoder runs: {@link declaredContentSize}
 * refuses anything that is not exactly one frame spanning every input byte and
 * bindingly declaring its size, and a declaration that differs from the signed
 * size is rejected. So neither a tiny frame claiming gigabytes nor a pack of
 * in-limit frames whose sum is gigabytes ever reaches WASM. The streaming
 * decoder then honours that declaration, `decompressEnd()` rejects a truncated
 * frame, and the length check below is the final fail-closed gate.
 *
 * Deliberately NOT `Zstd.decompress()`: that path allocates the frame's own
 * declared content size up front, which is exactly the attacker-controlled
 * number we refuse to trust.
 *
 * The three streaming calls run with no `await` between them, so they cannot
 * interleave with another caller on the library's process-wide singleton.
 */
export async function decompressBounded(
	bytes: Uint8Array,
	expectedSize: number,
): Promise<Uint8Array> {
	if (declaredContentSize(bytes) !== expectedSize) {
		throw new Error("zstd frame does not declare its signed size");
	}
	const zstd = await load();
	zstd.resetDecompression();
	const output = zstd.decompressChunk(bytes);
	zstd.decompressEnd();
	if (output.byteLength !== expectedSize) {
		throw new Error("zstd output does not match its signed size");
	}
	return output;
}

/** Test/diagnostic convenience for trusted local bytes. Runtime bundle reads use
 * {@link decompressBounded} with the signed manifest's validated chunk size. */
export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
	const zstd = await load();
	return zstd.decompress(bytes);
}
