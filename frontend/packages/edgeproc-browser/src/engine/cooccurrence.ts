// Item-to-item co-occurrence carried in the signed bundle as `cooccurrence.json`,
// the in-browser mirror of edge-reco's reco/cooccurrence.py CooccurrenceMatrix.
// A sparse top-N neighbour list per product ("customers who bought X also bought
// Y"): the seed's neighbours become the candidate pool for the `co_occurrence`
// strategies, and each neighbour's score feeds the scorer's cooccurrence term.
//
// Like ranking_config.json, the bytes arrive ALREADY ed25519/sha256-verified as
// part of the signed bundle — `parseCooccurrence` reads them off the verified sync
// path (runtime.ts). A bundle that predates the file has no manifest entry, so the
// read rejects and we degrade to EMPTY_COOCCURRENCE (no "also bought" neighbours).
//
// Keys are snake_case to match the JSON the Python producer writes byte-for-byte.

/** One co-occurrence neighbour: a product id and its normalised (cosine) score. */
export interface Neighbor {
	readonly id: string;
	readonly score: number;
}

/**
 * Sparse top-N neighbour map, the parsed `cooccurrence.json`. `neighbors[seed]` is
 * the seed product's ordered top-N co-engaged products (descending score); an
 * unknown seed maps to an empty list (graceful degrade).
 */
export interface CooccurrenceMatrix {
	readonly schema_version: number;
	readonly neighbors: Readonly<Record<string, ReadonlyArray<Neighbor>>>;
}

/** The empty matrix — the fallback for a bundle that predates cooccurrence.json. */
export const EMPTY_COOCCURRENCE: CooccurrenceMatrix = {
	schema_version: 1,
	neighbors: {},
};

const DECODER = new TextDecoder();

/**
 * Parse the verified `cooccurrence.json` bytes into a CooccurrenceMatrix. The bytes
 * arrive ALREADY ed25519/sha256-verified as part of the signed bundle (the runtime
 * reads them through the same materialize path as ranking_config.json). `undefined`
 * means an older bundle that predates the file → the empty matrix (no neighbours).
 *
 * Present-but-malformed bytes FAIL CLOSED: a neighbour missing its id, a non-string
 * id, or a non-finite score throws — it never silently degrades, so a corrupt-but-
 * signed matrix can't quietly feed NaN into the scorer's cooccurrence term.
 */
export function parseCooccurrence(
	bytes: Uint8Array | undefined,
): CooccurrenceMatrix {
	if (bytes === undefined) {
		return EMPTY_COOCCURRENCE;
	}
	return assertCooccurrence(JSON.parse(DECODER.decode(bytes)));
}

/**
 * Thrown when a present-but-malformed `cooccurrence.json` fails validation. Fails
 * CLOSED so a corrupt-but-signed neighbour list can't feed a NaN score into the
 * scorer's cooccurrence term and diverge from the Python tier.
 */
export class CooccurrenceError extends Error {
	public constructor(message: string) {
		super(`malformed cooccurrence.json: ${message}`);
		this.name = "CooccurrenceError";
	}
}

function assertNeighbor(value: unknown, at: string): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CooccurrenceError(`${at} must be an object`);
	}
	const record = value as Record<string, unknown>;
	if (typeof record.id !== "string") {
		throw new CooccurrenceError(`${at}.id must be a string`);
	}
	if (typeof record.score !== "number" || !Number.isFinite(record.score)) {
		throw new CooccurrenceError(`${at}.score must be a finite number`);
	}
}

function assertNeighbors(value: unknown): void {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CooccurrenceError("neighbors must be an object");
	}
	for (const [seed, list] of Object.entries(value as Record<string, unknown>)) {
		if (!Array.isArray(list)) {
			throw new CooccurrenceError(`neighbors.${seed} must be an array`);
		}
		list.forEach((n, i) => {
			assertNeighbor(n, `neighbors.${seed}[${i}]`);
		});
	}
}

/**
 * Runtime-validate parsed JSON into a CooccurrenceMatrix, mirroring the Python
 * Pydantic model. Throws CooccurrenceError on any shape/type mismatch.
 */
function assertCooccurrence(value: unknown): CooccurrenceMatrix {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new CooccurrenceError("root must be an object");
	}
	const record = value as Record<string, unknown>;
	if (typeof record.schema_version !== "number") {
		throw new CooccurrenceError("schema_version must be a number");
	}
	assertNeighbors(record.neighbors);
	return value as CooccurrenceMatrix;
}
