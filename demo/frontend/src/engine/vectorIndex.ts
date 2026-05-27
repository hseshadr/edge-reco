// In-browser vector retrieval over the synced bundle. Mirrors edge-reco's Python
// VectorSearcher (src/edgereco/search/vector.py): row i of embeddings.f32 is the
// L2-normalized vector for state.json faiss_ids[i], so cosine == dot product and
// the only renormalization needed is on the (possibly non-unit) query vector.

import type { Product } from "../api/types";

const DECODER = new TextDecoder();

/** The four reassembled bundle files the index is built from. */
export interface VectorIndexFiles {
	/** catalog_meta.json — carries embedding_count / embedding_dim. */
	readonly meta: Uint8Array;
	/** vector/state.json — carries the faiss_ids row->id map. */
	readonly state: Uint8Array;
	/** vector/embeddings.f32 — row-major L2-normalized float32, ntotal x dim. */
	readonly embeddings: Uint8Array;
	/** products.jsonl — one Product JSON object per line. */
	readonly products: Uint8Array;
}

/** A scored retrieval hit: a product id and its cosine similarity to the query. */
export interface VectorHit {
	readonly id: string;
	readonly score: number;
}

interface CatalogMeta {
	readonly embedding_count: number;
	readonly embedding_dim: number;
}

interface VectorState {
	readonly faiss_ids: ReadonlyArray<string>;
}

function parseJson<T>(bytes: Uint8Array): T {
	return JSON.parse(DECODER.decode(bytes)) as T;
}

/** Wrap embeddings.f32 as a typed view, asserting the byte length matches n*dim. */
function asMatrix(
	embeddings: Uint8Array,
	ntotal: number,
	dim: number,
): Float32Array {
	const expected = ntotal * dim * Float32Array.BYTES_PER_ELEMENT;
	if (embeddings.byteLength !== expected) {
		throw new Error(
			`embeddings.f32 is ${embeddings.byteLength} bytes; expected ${expected} (${ntotal}x${dim})`,
		);
	}
	// The reassembled bytes may not be 4-byte aligned; copy into a fresh buffer.
	const aligned = embeddings.slice();
	return new Float32Array(aligned.buffer, aligned.byteOffset, ntotal * dim);
}

function parseProducts(bytes: Uint8Array): ReadonlyMap<string, Product> {
	const map = new Map<string, Product>();
	for (const line of DECODER.decode(bytes).split("\n")) {
		if (line.trim().length === 0) {
			continue;
		}
		const product = JSON.parse(line) as Product;
		map.set(product.id, product);
	}
	return map;
}

function normalize(vector: Float32Array): Float32Array {
	let sumSq = 0;
	for (const value of vector) {
		sumSq += value * value;
	}
	const norm = Math.sqrt(sumSq);
	if (norm === 0) {
		return vector;
	}
	const out = new Float32Array(vector.length);
	for (let i = 0; i < vector.length; i += 1) {
		out[i] = (vector[i] ?? 0) / norm;
	}
	return out;
}

/** Loaded, query-ready vector index over the synced bundle. */
export class VectorIndex {
	readonly #matrix: Float32Array;
	readonly #ids: ReadonlyArray<string>;
	readonly #products: ReadonlyMap<string, Product>;
	readonly #dim: number;
	readonly #ntotal: number;

	public constructor(
		matrix: Float32Array,
		ids: ReadonlyArray<string>,
		products: ReadonlyMap<string, Product>,
		dim: number,
	) {
		this.#matrix = matrix;
		this.#ids = ids;
		this.#products = products;
		this.#dim = dim;
		this.#ntotal = ids.length;
	}

	public get ntotal(): number {
		return this.#ntotal;
	}

	public get dim(): number {
		return this.#dim;
	}

	public idAt(row: number): string {
		const id = this.#ids[row];
		if (id === undefined) {
			throw new RangeError(`row ${row} out of range`);
		}
		return id;
	}

	/** The L2-normalized stored vector for a row (a copy, safe to mutate). */
	public rowVector(row: number): Float32Array {
		if (row < 0 || row >= this.#ntotal) {
			throw new RangeError(`row ${row} out of range`);
		}
		return this.#matrix.slice(row * this.#dim, (row + 1) * this.#dim);
	}

	public product(id: string): Product | undefined {
		return this.#products.get(id);
	}

	/**
	 * Cosine top-k. Stored rows are L2-normalized, so cosine == dot product; the
	 * query is normalized here so a non-unit input scores correctly. A flat scan
	 * is exact and plenty fast for ~10^3 rows.
	 */
	public search(queryVec: Float32Array, k: number): ReadonlyArray<VectorHit> {
		if (queryVec.length !== this.#dim) {
			throw new Error(
				`query vector has ${queryVec.length} dims; index is ${this.#dim}`,
			);
		}
		const query = normalize(queryVec);
		const scored: { readonly row: number; readonly score: number }[] = [];
		for (let row = 0; row < this.#ntotal; row += 1) {
			let dot = 0;
			const base = row * this.#dim;
			for (let i = 0; i < this.#dim; i += 1) {
				dot += (this.#matrix[base + i] ?? 0) * (query[i] ?? 0);
			}
			scored.push({ row, score: dot });
		}
		// Descending score; ties broken by ascending row index so the ordering is
		// deterministic. Tie order between equal-score rows (e.g. byte-identical
		// duplicate-vector products) is not semantically meaningful — FAISS's own
		// tie order is a heap artifact — so parity is asserted per score group.
		scored.sort((a, b) => b.score - a.score || a.row - b.row);
		return scored
			.slice(0, Math.max(0, k))
			.map((hit) => ({ id: this.idAt(hit.row), score: hit.score }));
	}
}

/** Parse the synced files and build a query-ready VectorIndex. */
export function loadVectorIndex(files: VectorIndexFiles): Promise<VectorIndex> {
	const meta = parseJson<CatalogMeta>(files.meta);
	const state = parseJson<VectorState>(files.state);
	const dim = meta.embedding_dim;
	const ntotal = state.faiss_ids.length;
	if (meta.embedding_count !== ntotal) {
		throw new Error(
			`catalog_meta embedding_count ${meta.embedding_count} != faiss_ids length ${ntotal}`,
		);
	}
	const matrix = asMatrix(files.embeddings, ntotal, dim);
	const products = parseProducts(files.products);
	return Promise.resolve(
		new VectorIndex(matrix, state.faiss_ids, products, dim),
	);
}
