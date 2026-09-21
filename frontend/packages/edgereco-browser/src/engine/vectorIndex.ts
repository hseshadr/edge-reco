// In-browser vector retrieval over the synced bundle. Mirrors edge-reco's Python
// VectorSearcher (src/edgereco/search/vector.py): row i of embeddings.f32 is the
// L2-normalized vector for state.json faiss_ids[i], so cosine == dot product and
// the only renormalization needed is on the (possibly non-unit) query vector.

import { PackedVectorIndex } from "@edgeproc/browser/vector";
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

/** A whole count ≥ 1 — rejects 0, negatives, fractions and non-numbers. */
function assertPositiveInt(value: unknown, at: string): number {
	if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
		throw new VectorIndexError(`${at} must be an integer >= 1`);
	}
	return value;
}

/** A finite number OR null (price is optional per Product) — rejects all else. */
function assertFiniteOrNull(value: unknown, at: string): void {
	if (value === null) {
		return;
	}
	assertFiniteNumber(value, at);
}

function assertStringField(
	record: Record<string, unknown>,
	field: string,
	at: string,
): void {
	if (typeof record[field] !== "string") {
		throw new VectorIndexError(`${at}.${field} must be a string`);
	}
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
	assertPositiveInt(
		record.embedding_count,
		"catalog_meta.json.embedding_count",
	);
	assertPositiveInt(record.embedding_dim, "catalog_meta.json.embedding_dim");
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
		throw new VectorIndexError(
			`embeddings.f32 is ${embeddings.byteLength} bytes; expected ${expected} (${ntotal}x${dim})`,
		);
	}
	// The reassembled bytes may not be 4-byte aligned; copy into a fresh buffer.
	const aligned = embeddings.slice();
	return new Float32Array(aligned.buffer, aligned.byteOffset, ntotal * dim);
}

/** The display/ranking-critical Product string fields validated before the cast. */
const PRODUCT_STRING_FIELDS = ["title", "category", "brand"] as const;

/**
 * Field-by-field guard for one product row (mirrors rankingConfig.ts's style):
 * the ranking/display-critical fields must be well-typed so a corrupt-but-signed
 * product can't silently feed NaN into the scorer or blank text into the rail.
 * `id` is validated by the caller (so it can narrow the map key).
 */
function assertProductFields(
	record: Record<string, unknown>,
	at: string,
): void {
	for (const field of PRODUCT_STRING_FIELDS) {
		assertStringField(record, field, at);
	}
	if (!Array.isArray(record.tags)) {
		throw new VectorIndexError(`${at}.tags must be an array`);
	}
	assertFiniteNumber(record.popularity_score, `${at}.popularity_score`);
	assertFiniteNumber(record.freshness_score, `${at}.freshness_score`);
	assertFiniteOrNull(record.price, `${at}.price`);
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
		assertProductFields(record, at);
		map.set(record.id, record as unknown as Product);
	});
	return map;
}

/** Loaded, query-ready vector index over the synced bundle. */
export class VectorIndex {
	readonly #vectors: PackedVectorIndex;
	readonly #ids: ReadonlyArray<string>;
	readonly #rowOf: ReadonlyMap<string, number>;
	readonly #products: ReadonlyMap<string, Product>;

	public constructor(
		matrix: Float32Array,
		ids: ReadonlyArray<string>,
		products: ReadonlyMap<string, Product>,
		dim: number,
	) {
		this.#vectors = new PackedVectorIndex(matrix, ids, dim);
		this.#ids = ids;
		this.#rowOf = new Map(ids.map((id, row) => [id, row]));
		this.#products = products;
	}

	public get ntotal(): number {
		return this.#vectors.ntotal;
	}

	public get dim(): number {
		return this.#vectors.dim;
	}

	public idAt(row: number): string {
		return this.#vectors.idAt(row);
	}

	/** The L2-normalized stored vector for a row (a copy, safe to mutate). */
	public rowVector(row: number): Float32Array {
		return this.#vectors.vectorAt(row);
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
		return this.#vectors
			.search(queryVec, Math.max(0, k))
			.map((hit) => ({ id: hit.id, score: hit.similarity }));
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
		throw new VectorIndexError(
			`catalog_meta embedding_count ${meta.embedding_count} != faiss_ids length ${ntotal}`,
		);
	}
	const matrix = asMatrix(files.embeddings, ntotal, dim);
	const products = parseProducts(files.products);
	try {
		return new VectorIndex(matrix, state.faiss_ids, products, dim);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		throw new VectorIndexError(`vector index rejected the bundle: ${message}`);
	}
}
