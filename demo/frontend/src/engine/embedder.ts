// In-browser query embedder. Reproduces edge-reco's Python ProductEncoder, which
// delegates to EdgeProc's TextEncoder: sentence-transformers all-MiniLM-L6-v2 with
// `normalize_embeddings=True`, i.e. mean-pooling over token embeddings followed by
// L2-normalization. transformers.js feature-extraction with
// `{ pooling: "mean", normalize: true }` is the byte-for-byte equivalent of that
// recipe, so embed(text) here matches encode_query(text) on the server to ~1e-3.
//
// The model load is async and heavy (~25 MB of weights), so the real pipeline is
// created once and cached. The Worker wrapper (createEmbedderWorkerHandler) keeps
// the load + inference off the main thread; the pure Embedder below is what the
// parity test exercises directly in Node.

import { pipeline } from "@huggingface/transformers";

/** The sentence-transformers model id, mirrored as its Xenova ONNX export. */
export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

/** all-MiniLM-L6-v2 produces 384-dimensional embeddings. */
export const EMBEDDING_DIM = 384;

/** Embeds a query string into a normalized 384-d vector. */
export interface Embedder {
	embed(text: string): Promise<Float32Array>;
}

/** A feature-extraction call producing a flat numeric data buffer. */
type ExtractFn = (
	text: string,
	options: { readonly pooling: "mean"; readonly normalize: boolean },
) => Promise<{ readonly data: ArrayLike<number> }>;

/** A narrowed view of transformers.js `pipeline`: building the feature-extraction
 * task yields a callable ExtractFn. The library's own overload union over every
 * task is too large for the compiler to represent (TS2590), so it is collapsed to
 * the one signature this module uses. */
type LoadFeatureExtraction = (
	task: "feature-extraction",
	model: string,
) => Promise<ExtractFn>;

class PipelineEmbedder implements Embedder {
	readonly #load: () => Promise<ExtractFn>;
	#extract: ExtractFn | undefined;

	public constructor(load: () => Promise<ExtractFn>) {
		this.#load = load;
	}

	public async embed(text: string): Promise<Float32Array> {
		if (this.#extract === undefined) {
			this.#extract = await this.#load();
		}
		const output = await this.#extract(text, {
			pooling: "mean",
			normalize: true,
		});
		const vector = Float32Array.from(output.data);
		if (vector.length !== EMBEDDING_DIM) {
			throw new Error(
				`embedding has ${vector.length} dims; expected ${EMBEDDING_DIM}`,
			);
		}
		return vector;
	}
}

async function defaultExtractFn(): Promise<ExtractFn> {
	const load = pipeline as unknown as LoadFeatureExtraction;
	return load("feature-extraction", EMBEDDING_MODEL);
}

/**
 * The default embedder, backed by the transformers.js feature-extraction
 * pipeline. The model is fetched + compiled lazily on the first embed call and
 * cached for the lifetime of the embedder.
 */
export function createEmbedder(): Embedder {
	return new PipelineEmbedder(defaultExtractFn);
}

/**
 * An embedder over an injected extractor — the seam the parity test uses to run
 * the real transformers.js pipeline in Node without a Worker.
 */
export function createEmbedderWith(load: () => Promise<ExtractFn>): Embedder {
	return new PipelineEmbedder(load);
}

export type { ExtractFn };
