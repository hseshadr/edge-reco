// What `decompressBounded` demands OF THE DECODER, proven with a stand-in.
//
// Two of its three gates cannot be driven from real bytes any more, because
// libzstd already refuses to emit more content than a frame declares and the
// frame walk in `declaredContentSize` already rejects truncated input before
// the decoder ever runs. Stubbing the decoder is what keeps them non-vacuous:
// it lets us break the property (a decoder that over-produces, a decoder that
// reports a truncated frame) and watch the guard hold. That failure mode is not
// hypothetical — it is exactly what 1.15.0's dropped `outputSize` parameter
// turned the old code into.
//
// It also gives the pre-decode claim its direct proof: for a refused input the
// decoder records ZERO calls, so no attacker byte was ever handed to WASM.

import { beforeEach, describe, expect, it, vi } from "vitest";

const decoder = {
	/** Every buffer handed to decompressChunk, in order. Empty => nothing decoded. */
	calls: [] as Uint8Array[],
	/** What decompressChunk returns. */
	output: new Uint8Array(0),
	/** When set, decompressEnd throws it (libzstd reports truncation here). */
	endError: null as Error | null,
	resets: 0,
};

vi.mock("@hpcc-js/wasm-zstd", () => ({
	Zstd: {
		load: async () => ({
			resetDecompression: () => {
				decoder.resets += 1;
			},
			decompressChunk: (bytes: Uint8Array) => {
				decoder.calls.push(bytes);
				return decoder.output;
			},
			decompressEnd: () => {
				if (decoder.endError !== null) {
					throw decoder.endError;
				}
			},
		}),
	},
}));

const { declaredContentSize, decompressBounded } = await import("./zstd");

const SIGNED = 64;

/** A minimal, structurally valid single zstd frame: single-segment, a 4-byte
 * Frame_Content_Size declaring `declaredSize`, and one Last_Block RLE block.
 * Its body is never really decoded here — the decoder above is a stand-in. */
function frame(declaredSize: number): Uint8Array {
	const bytes = new Uint8Array(13);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, 0xfd2f_b528, true);
	view.setUint8(4, 0xa0); // Frame_Content_Size_flag=2 (4 bytes) | Single_Segment
	view.setUint32(5, declaredSize, true);
	// Block_Header: Block_Size=1 | Block_Type=RLE(1) | Last_Block=1.
	view.setUint8(9, (1 << 3) | (1 << 1) | 1);
	return bytes;
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

beforeEach(() => {
	decoder.calls = [];
	decoder.output = new Uint8Array(SIGNED);
	decoder.endError = null;
	decoder.resets = 0;
});

describe("nothing reaches the decoder unless it is already bounded", () => {
	it("hands the decoder ZERO bytes when the frame declares more than the signed size", async () => {
		await expect(
			decompressBounded(frame(4 * 1024 * 1024), SIGNED),
		).rejects.toThrow("zstd frame does not declare its signed size");
		expect(decoder.calls).toHaveLength(0);
		expect(decoder.resets).toBe(0);
	});

	// The multi-frame bomb, at the boundary that matters: 512 KiB of frames each
	// declaring exactly the signed size decodes to gigabytes in ONE
	// decompressChunk call, so "refused" has to mean the call never happened.
	it("hands the decoder ZERO bytes for concatenated signed-size frames", async () => {
		const packed = concat(...Array.from({ length: 64 }, () => frame(SIGNED)));
		expect(declaredContentSize(frame(SIGNED))).toBe(SIGNED);
		expect(declaredContentSize(packed)).toBeNull();

		await expect(decompressBounded(packed, SIGNED)).rejects.toThrow(
			"zstd frame does not declare its signed size",
		);
		expect(decoder.calls).toHaveLength(0);
		expect(decoder.resets).toBe(0);
	});

	it("decodes a single frame that declares exactly the signed size", async () => {
		await expect(
			decompressBounded(frame(SIGNED), SIGNED),
		).resolves.toHaveLength(SIGNED);
		expect(decoder.calls).toHaveLength(1);
		expect(decoder.calls[0]?.byteLength).toBe(13);
		expect(decoder.resets).toBe(1);
	});
});

describe("the decoder's own completion report is honoured", () => {
	it("propagates a truncated-frame report instead of returning partial output", async () => {
		// libzstd surfaces truncation from decompressEnd(), AFTER decompressChunk
		// has already returned a buffer without complaint.
		decoder.endError = new Error(
			"decompressEnd failed: truncated Zstandard input",
		);

		await expect(decompressBounded(frame(SIGNED), SIGNED)).rejects.toThrow(
			/truncated Zstandard input/,
		);
	});
});

describe("the output length is re-checked after decoding", () => {
	it("rejects output longer than the signed size the frame declared", async () => {
		// A decoder that emits more than the frame declared is the failure this
		// gate exists for — and is precisely what the silently-ignored
		// `outputSize` argument allowed.
		decoder.output = new Uint8Array(SIGNED + 1);

		await expect(decompressBounded(frame(SIGNED), SIGNED)).rejects.toThrow(
			"zstd output does not match its signed size",
		);
	});

	it("rejects output shorter than the signed size the frame declared", async () => {
		decoder.output = new Uint8Array(SIGNED - 1);

		await expect(decompressBounded(frame(SIGNED), SIGNED)).rejects.toThrow(
			"zstd output does not match its signed size",
		);
	});
});
