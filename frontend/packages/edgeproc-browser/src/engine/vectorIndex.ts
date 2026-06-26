// In-browser vector retrieval over the synced bundle. Mirrors edge-reco's Python
// VectorSearcher (src/edgereco/search/vector.py): row i of embeddings.f32 is the
// L2-normalized vector for state.json faiss_ids[i], so cosine == dot product and
// the only renormalization needed is on the (possibly non-unit) query vector.

import type { Product } from "./domain";

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

/**
 * Thrown when present-but-malformed catalog bundle data (catalog_meta.json,
 * vector/state.json, or products.jsonl) fails validation. The browser tier fails
 * CLOSED here — like rankingConfig.ts / cooccurrence.ts — so a corrupt-but-signed
 * bundle surfaces loudly instead of being blindly `as T` cast into the index,
 * where a non-string id or non-finite dim would silently corrupt retrieval and
 * diverge from the Python tier.
 */
export class VectorIndexError extends Error {
	public constructor(message: string) {
		super(`malformed catalog bundle: ${message}`);
		this.name = "VectorIndexError";
	}
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new VectorIndexError(`${at} must be an object`);
	}
	return value as Record<string, unknown>;
}

/** A finite number — rejects strings, null, NaN and ±Infinity. */
function assertFiniteNumber(value: unknown, at: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new VectorIndexError(`${at} must be a finite number`);
	}
	return value;
}

function parseJsonBytes(bytes: Uint8Array, at: string): unknown {
	try {
		return JSON.parse(DECODER.decode(bytes));
	} catch {
		throw new VectorIndexError(`${at} is not valid JSON`);
	}
}

/** Validate catalog_meta.json into a typed CatalogMeta, or fail closed. */
function parseCatalogMeta(bytes: Uint8Array): CatalogMeta {
	const record = asRecord(
		parseJsonBytes(bytes, "catalog_meta.json"),
		"catalog_meta.json",
	);
	assertFiniteNumber(
		record.embedding_count,
		"catalog_meta.json.embedding_count",
	);
	assertFiniteNumber(record.embedding_dim, "catalog_meta.json.embedding_dim");
	return record as unknown as CatalogMeta;
}

/** Validate vector/state.json into a typed VectorState, or fail closed. */
function parseVectorState(bytes: Uint8Array): VectorState {
	const record = asRecord(
		parseJsonBytes(bytes, "vector/state.json"),
		"vector/state.json",
	);
	const ids = record.faiss_ids;
	if (!Array.isArray(ids)) {
		throw new VectorIndexError("vector/state.json.faiss_ids must be an array");
	}
	ids.forEach((id, i) => {
		if (typeof id !== "string") {
			throw new VectorIndexError(
				`vector/state.json.faiss_ids[${i}] must be a string`,
			);
		}
	});
	return record as unknown as VectorState;
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
	const lines = DECODER.decode(bytes).split("\n");
	lines.forEach((line, i) => {
		if (line.trim().length === 0) {
			return;
		}
		const at = `products.jsonl[${i}]`;
		const record = asRecord(
			parseJsonBytes(new TextEncoder().encode(line), at),
			at,
		);
		if (typeof record.id !== "string") {
			throw new VectorIndexError(`${at}.id must be a string`);
		}
		map.set(record.id, record as unknown as Product);
	});
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
	readonly #rowOf: ReadonlyMap<string, number>;
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
		this.#rowOf = new Map(ids.map((id, row) => [id, row]));
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

	/** All products, in faiss_ids row order (the catalog order from the bundle). */
	public products(): ReadonlyArray<Product> {
		const out: Product[] = [];
		for (const id of this.#ids) {
			const product = this.#products.get(id);
			if (product !== undefined) {
				out.push(product);
			}
		}
		return out;
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

	/**
	 * Top-k products nearest a SEED product's stored vector, the seed excluded.
	 * Mirrors VectorSearcher.nearest (embeddings/index.py): look up the seed row,
	 * take its L2-normalized vector, cosine-search k+1 (room to drop the seed),
	 * then return the k descending (id, cosine) pairs. Throws on an unknown id.
	 */
	public nearest(productId: string, k: number): ReadonlyArray<VectorHit> {
		const row = this.#rowOf.get(productId);
		if (row === undefined) {
			throw new Error(`unknown product id: ${productId}`);
		}
		const seedVec = this.rowVector(row);
		const hits = this.search(seedVec, k + 1);
		return hits.filter((hit) => hit.id !== productId).slice(0, k);
	}
}

/**
 * Parse the synced files and build a query-ready VectorIndex.
 *
 * `async` so the fail-closed validators (parseCatalogMeta / parseVectorState /
 * parseProducts) surface as a REJECTED promise rather than a synchronous throw —
 * callers await this, so a corrupt-but-signed bundle rejects cleanly instead of
 * tripping a sync throw the await site can't catch.
 */
export async function loadVectorIndex(
	files: VectorIndexFiles,
): Promise<VectorIndex> {
	const meta = parseCatalogMeta(files.meta);
	const state = parseVectorState(files.state);
	const dim = meta.embedding_dim;
	const ntotal = state.faiss_ids.length;
	if (meta.embedding_count !== ntotal) {
		throw new Error(
			`catalog_meta embedding_count ${meta.embedding_count} != faiss_ids length ${ntotal}`,
		);
	}
	const matrix = asMatrix(files.embeddings, ntotal, dim);
	const products = parseProducts(files.products);
	return new VectorIndex(matrix, state.faiss_ids, products, dim);
}
