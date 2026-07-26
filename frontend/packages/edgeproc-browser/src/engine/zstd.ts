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

// --- Zstandard frame header (RFC 8878 section 3.1.1) ------------------------
//
// We read the frame's DECLARED decompressed size ourselves, before any byte
// reaches the decoder. That declaration is what bounds decompression: a frame is
// handed to WASM only once it claims exactly the size the signed manifest says,
// and libzstd then refuses to emit more content than the frame declared. Parsing
// 6-14 bytes of header is the whole guard — see `decompressBounded`.

const ZSTD_MAGIC = 0xfd2f_b528;
/** Frame_Content_Size field width, indexed by Frame_Content_Size_flag. */
const FCS_FIELD_SIZES = [0, 2, 4, 8] as const;
/** Dictionary_ID field width, indexed by Dictionary_ID_flag. */
const DICTIONARY_ID_SIZES = [0, 1, 2, 4] as const;
/** Frame_Header_Descriptor bits 4 and 3 are "unused" and "reserved": both zero. */
const MUST_BE_ZERO_BITS = 0b0001_1000;
const SINGLE_SEGMENT_BIT = 0b0010_0000;
/** Smallest frame that can carry a declaration: magic(4) + descriptor(1) + FCS(1). */
const MIN_DECLARING_FRAME_BYTES = 6;

/** Where the Frame_Content_Size field sits, and how wide it is. */
interface FrameContentSizeField {
	readonly offset: number;
	readonly width: number;
}

/** Decode the Frame_Header_Descriptor byte into the FCS field's position/width. */
function contentSizeField(descriptor: number): FrameContentSizeField | null {
	if ((descriptor & MUST_BE_ZERO_BITS) !== 0) {
		return null;
	}
	const singleSegment = (descriptor & SINGLE_SEGMENT_BIT) !== 0;
	const flag = descriptor >>> 6;
	// Flag 0 means "1 byte" for single-segment frames and "absent" otherwise.
	const width =
		flag === 0 ? Number(singleSegment) : (FCS_FIELD_SIZES[flag] ?? 0);
	// magic(4) + descriptor(1) + Window_Descriptor(1, single-segment omits it).
	const offset =
		5 + Number(!singleSegment) + (DICTIONARY_ID_SIZES[descriptor & 0b11] ?? 0);
	return { offset, width };
}

/** Read the little-endian FCS field. The 2-byte form stores `size - 256`. */
function readContentSize(view: DataView, field: FrameContentSizeField): number {
	if (field.width === 1) {
		return view.getUint8(field.offset);
	}
	if (field.width === 2) {
		return view.getUint16(field.offset, true) + 256;
	}
	if (field.width === 4) {
		return view.getUint32(field.offset, true);
	}
	return Number(view.getBigUint64(field.offset, true));
}

/**
 * The decompressed size a zstd frame declares in its header, or `null` when the
 * bytes are not a zstd frame or the frame omits the declaration (streamed frames
 * may). Exported for tests: every chunk the Python producer writes must declare
 * the size its signed manifest entry claims.
 */
export function declaredContentSize(bytes: Uint8Array): number | null {
	if (bytes.byteLength < MIN_DECLARING_FRAME_BYTES) {
		return null;
	}
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(0, true) !== ZSTD_MAGIC) {
		return null;
	}
	const field = contentSizeField(view.getUint8(4));
	if (field === null || field.width === 0) {
		return null;
	}
	if (bytes.byteLength < field.offset + field.width) {
		return null;
	}
	return readContentSize(view, field);
}

/**
 * Decompress a frame that must declare — and produce — exactly `expectedSize`.
 *
 * The bound is applied BEFORE the decoder runs: we parse the frame header and
 * refuse anything whose declared Frame_Content_Size is absent or differs from
 * the signed size, so a tiny frame claiming gigabytes never reaches WASM. The
 * streaming decoder then honours that declaration, `decompressEnd()` rejects a
 * truncated frame, and the length check below is the final fail-closed gate.
 *
 * Deliberately NOT `Zstd.decompress()`: that path allocates the frame's own
 * declared content size up front, which is exactly the attacker-controlled
 * number we refuse to trust.
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
