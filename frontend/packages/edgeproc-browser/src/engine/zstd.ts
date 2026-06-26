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

/** Decompress verbatim zstd bytes to plaintext. */
export async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
	const zstd = await load();
	return zstd.decompress(bytes);
}
