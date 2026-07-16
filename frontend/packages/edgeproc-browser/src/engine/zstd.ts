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

/** Decompress into an exact bounded output buffer. `decompressChunk` allocates
 * only `expectedSize`, so a tiny frame claiming gigabytes cannot make WASM reserve
 * the attacker-controlled frame size before we can inspect the output. */
export async function decompressBounded(
	bytes: Uint8Array,
	expectedSize: number,
): Promise<Uint8Array> {
	const zstd = await load();
	zstd.reset();
	const output = zstd.decompressChunk(bytes, expectedSize);
	const overflow = zstd.decompressChunk(new Uint8Array(), 1);
	if (output.byteLength !== expectedSize || overflow.byteLength !== 0) {
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
