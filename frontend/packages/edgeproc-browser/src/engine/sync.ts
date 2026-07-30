// Signed-bundle sync state machine. Every attacker-controlled dimension is
// bounded before allocation/fetch, and promotion remains the final operation.

import { canonicalBytes, type JsonValue } from "./canonical";
import { sha256Hex } from "./crypto";
import { NetworkError } from "./fetchBytes";
import { IntegrityError, MAX_DECOMPRESSED_CHUNK_BYTES } from "./integrity";
import type {
	CacheStore,
	ChunkRef,
	FetchBytes,
	FetchBytesOptions,
	FileEntry,
	IndexManifest,
	SyncResult,
	Verify,
	VersionPointer,
} from "./types";

interface SyncArgs {
	readonly baseUrl: string;
	readonly store: CacheStore;
	readonly fetchBytes: FetchBytes;
	readonly verify: Verify;
	readonly expectedBundleId?: string;
	readonly expectedChannel?: string;
	/** Tests/operators may only LOWER the aggregate cap, never raise the release
	 * ceiling. This keeps failure paths cheap to exercise without weakening prod. */
	readonly limits?: { readonly maxTotalFetchBytes?: number };
}

const DECODER = new TextDecoder();
const SHA256 = /^[0-9a-f]{64}$/u;
const MAX_POINTER_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_COMPRESSED_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_FETCH_BYTES = 256 * 1024 * 1024;
// The signed bundle now ships one license-clean product image (images/<id>.svg)
// per catalog product alongside the core index files, so a 720-product demo
// carries ~728 files. This cap gives bounded headroom over that while remaining
// a real DoS guard; aggregate byte/chunk ceilings below still bound total work.
const MAX_SYNC_FILES = 1024;
const MAX_CHUNK_REFS = 8192;
const MAX_DISTINCT_CHUNKS = 4096;
const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;
const MAX_CONCURRENT_CHUNK_FETCHES = 8;

export class SyncCapError extends IntegrityError {
	public constructor(message: string) {
		super(message);
		this.name = "SyncCapError";
	}
}

export class RollbackError extends IntegrityError {
	public constructor(message: string) {
		super(message);
		this.name = "RollbackError";
	}
}

function parseJson(bytes: Uint8Array, label: string): unknown {
	try {
		return JSON.parse(DECODER.decode(bytes)) as unknown;
	} catch (cause) {
		throw new IntegrityError(`${label} is not valid JSON`, { cause });
	}
}

function objectAt(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new IntegrityError(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function assertHash(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !SHA256.test(value)) {
		throw new IntegrityError(`${label} must be a lowercase SHA-256 digest`);
	}
}

function assertBoundedInteger(
	value: unknown,
	label: string,
	maximum: number,
): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < 0) {
		throw new IntegrityError(`${label} must be a non-negative safe integer`);
	}
	if ((value as number) > maximum) {
		throw new SyncCapError(`${label} exceeds ${maximum}-byte cap`);
	}
}

function assertVersionPointer(value: unknown): asserts value is VersionPointer {
	const pointer = objectAt(value, "signed latest pointer");
	assertHash(pointer.manifest_hash, "pointer manifest_hash");
	if (
		typeof pointer.version !== "string" ||
		pointer.version.length === 0 ||
		pointer.version.length > 200 ||
		typeof pointer.signature !== "string" ||
		pointer.signature.length === 0 ||
		pointer.signature.length > 512
	) {
		throw new IntegrityError(
			"signed latest pointer has invalid version/signature",
		);
	}
	if (
		!Number.isSafeInteger(pointer.sequence) ||
		(pointer.sequence as number) < 0
	) {
		throw new IntegrityError(
			"signed latest pointer is missing a non-negative monotonic sequence",
		);
	}
	for (const field of ["bundle_id", "channel"] as const) {
		const item = pointer[field];
		if (item !== undefined && item !== null && typeof item !== "string") {
			throw new IntegrityError(`pointer ${field} must be a string or null`);
		}
	}
}

function pointerSigningBytes(pointer: VersionPointer): Uint8Array {
	return canonicalBytes(pointer as unknown as JsonValue, {
		exclude: {
			signature: true,
			...(pointer.bundle_id == null ? { bundle_id: true as const } : {}),
			...(pointer.channel == null ? { channel: true as const } : {}),
		},
	});
}

async function fetchCapped(
	fetchBytes: FetchBytes,
	url: string,
	maxBytes: number,
	options: FetchBytesOptions = {},
): Promise<Uint8Array> {
	const bytes = await fetchBytes(url, { ...options, maxBytes });
	if (bytes.byteLength > maxBytes) {
		throw new SyncCapError(
			`${url} returned ${bytes.byteLength} bytes > ${maxBytes}-byte response cap`,
		);
	}
	return bytes;
}

async function fetchPointer(
	baseUrl: string,
	fetchBytes: FetchBytes,
	verify: Verify,
): Promise<VersionPointer> {
	const raw = await fetchCapped(
		fetchBytes,
		`${baseUrl}/latest`,
		MAX_POINTER_BYTES,
		{ cache: "no-store" },
	);
	const pointer = parseJson(raw, "signed latest pointer");
	assertVersionPointer(pointer);
	await verify(pointerSigningBytes(pointer), pointer.signature);
	return pointer;
}

// ---- Anti-rollback: proof of freshness, never absence of disproof ----------
//
// A validly signed but STALE `/latest` (a replayed old pointer) must not
// downgrade a client that already promoted a newer bundle. Two comparisons can
// supply the proof — a monotonic counter, or a comparable version — and the
// durable active pointer they are read from is untrusted (it survives in OPFS
// across sessions and can be corrupted or tampered with). So each comparison
// answers with what it actually PROVED, and a promote nothing proved is
// refused. Answering "cannot compare" with "then it is not a rollback" is the
// fail-OPEN defect this mirrors out of edge-proc's `cas.py`.

/** What ONE freshness comparison proved. */
type Freshness = "fresh" | "stale" | "undecidable";

/** Optional leading `v`, then dot-separated non-negative integers — and
 * nothing else. A date, a git sha or a pre-release suffix is NOT comparable
 * and must not be guessed at. */
const RELEASE = /^v?\d+(?:\.\d+)*$/u;
const MAX_VERSION_CHARS = 200;

const STALE_SEQUENCE =
	"refusing rollback: sequence is not fresher than the active pointer's";
const STALE_VERSION =
	"refusing rollback: version is older than the active pointer's";
const UNPROVABLE =
	"refusing rollback: neither a monotonic sequence nor a comparable version proves the incoming pointer is fresher";

function parseRelease(version: unknown): readonly number[] | null {
	if (
		typeof version !== "string" ||
		version.length > MAX_VERSION_CHARS ||
		!RELEASE.test(version)
	) {
		return null;
	}
	return version.replace(/^v/u, "").split(".").map(Number);
}

function compareRelease(a: readonly number[], b: readonly number[]): number {
	for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function sameIdentity(a: VersionPointer, b: VersionPointer): boolean {
	return (
		a.manifest_hash === b.manifest_hash &&
		a.version === b.version &&
		(a.bundle_id ?? null) === (b.bundle_id ?? null) &&
		(a.channel ?? null) === (b.channel ?? null)
	);
}

/** Monotonic-counter verdict. An active counter that is absent (a pre-sequence
 * store) or unparseable (a corrupted one) has no counter state to compare, so
 * it decides nothing and the version is left to speak. */
function sequenceFreshness(
	incoming: VersionPointer,
	active: VersionPointer,
): Freshness {
	const counter = active.sequence;
	if (!Number.isSafeInteger(counter) || counter < 0) return "undecidable";
	if (incoming.sequence > counter) return "fresh";
	if (incoming.sequence < counter) return "stale";
	// Equal counters: re-promoting the SAME identity is idempotent, anything
	// else is a publisher equivocating at one sequence.
	return sameIdentity(incoming, active) ? "fresh" : "stale";
}

/** Release-version verdict; an unparseable version on either side proves
 * nothing. Equal versions prove freshness only for the same manifest — an
 * equal-version fork says nothing about which side is newer. */
function versionFreshness(
	incoming: VersionPointer,
	active: VersionPointer,
): Freshness {
	const here = parseRelease(incoming.version);
	const there = parseRelease(active.version);
	if (here === null || there === null) return "undecidable";
	const order = compareRelease(here, there);
	if (order < 0) return "stale";
	if (order > 0) return "fresh";
	return incoming.manifest_hash === active.manifest_hash
		? "fresh"
		: "undecidable";
}

/** Why `incoming` may not replace `active` — or null when it provably may. */
function downgradeReason(
	incoming: VersionPointer,
	active: VersionPointer,
): string | null {
	const sequence = sequenceFreshness(incoming, active);
	if (sequence === "stale") return STALE_SEQUENCE;
	const version = versionFreshness(incoming, active);
	if (version === "stale") return STALE_VERSION;
	if (sequence === "fresh" || version === "fresh") return null;
	return UNPROVABLE;
}

function assertExpectedIdentity(pointer: VersionPointer, args: SyncArgs): void {
	if (
		args.expectedBundleId !== undefined &&
		pointer.bundle_id !== args.expectedBundleId
	) {
		throw new IntegrityError(
			"signed pointer does not match expected bundle identity",
		);
	}
	if (
		args.expectedChannel !== undefined &&
		pointer.channel !== args.expectedChannel
	) {
		throw new IntegrityError(
			"signed pointer does not match expected release channel",
		);
	}
}

function assertSafePath(path: unknown): asserts path is string {
	if (
		typeof path !== "string" ||
		path.length === 0 ||
		path.length > 1024 ||
		path.startsWith("/") ||
		path.includes("\\") ||
		path.split("/").includes("..")
	) {
		throw new IntegrityError(`manifest contains unsafe path ${String(path)}`);
	}
}

function checkedAdd(total: number, value: number, label: string): number {
	const result = total + value;
	if (!Number.isSafeInteger(result)) {
		throw new SyncCapError(`${label} exceeds safe integer range`);
	}
	return result;
}

function assertManifest(
	value: unknown,
	pointer: VersionPointer,
): asserts value is IndexManifest {
	const manifest = objectAt(value, "manifest");
	if (
		manifest.schema_version !== 2 ||
		typeof manifest.bundle_id !== "string" ||
		typeof manifest.version !== "string" ||
		!Array.isArray(manifest.files) ||
		manifest.files.length > MAX_SYNC_FILES
	) {
		throw new SyncCapError(
			`manifest schema/shape/file count is invalid (expected schema 2; maximum ${MAX_SYNC_FILES} files)`,
		);
	}
	if (manifest.version !== pointer.version) {
		throw new IntegrityError("pointer and manifest versions differ");
	}
	if (pointer.bundle_id != null && manifest.bundle_id !== pointer.bundle_id) {
		throw new IntegrityError("pointer and manifest bundle identities differ");
	}
	const paths = new Set<string>();
	const chunks = new Map<string, number>();
	let references = 0;
	let totalFiles = 0;
	for (const rawFile of manifest.files) {
		const file = objectAt(rawFile, "manifest file");
		assertSafePath(file.path);
		if (paths.has(file.path)) {
			throw new IntegrityError(`manifest repeats path ${file.path}`);
		}
		paths.add(file.path);
		assertHash(file.file_sha256, `file ${file.path} hash`);
		assertBoundedInteger(file.size, `file ${file.path} size`, MAX_FILE_BYTES);
		if (!Array.isArray(file.chunks)) {
			throw new IntegrityError(`file ${file.path} chunks must be an array`);
		}
		let assembledSize = 0;
		for (const rawRef of file.chunks) {
			const ref = objectAt(rawRef, `file ${file.path} chunk`);
			assertHash(ref.hash, `file ${file.path} chunk hash`);
			assertBoundedInteger(
				ref.size,
				`chunk ${ref.hash} size`,
				MAX_DECOMPRESSED_CHUNK_BYTES,
			);
			references += 1;
			if (references > MAX_CHUNK_REFS) {
				throw new SyncCapError(
					`manifest exceeds ${MAX_CHUNK_REFS} chunk-reference cap`,
				);
			}
			const previous = chunks.get(ref.hash);
			if (previous !== undefined && previous !== ref.size) {
				throw new IntegrityError(`chunk ${ref.hash} has conflicting sizes`);
			}
			chunks.set(ref.hash, ref.size);
			assembledSize = checkedAdd(assembledSize, ref.size, "file size");
		}
		if (assembledSize !== file.size) {
			throw new IntegrityError(
				`file ${file.path} declares ${file.size} bytes but chunks total ${assembledSize}`,
			);
		}
		totalFiles = checkedAdd(totalFiles, file.size, "manifest file bytes");
	}
	if (chunks.size > MAX_DISTINCT_CHUNKS) {
		throw new SyncCapError(
			`manifest exceeds ${MAX_DISTINCT_CHUNKS} distinct-chunk cap`,
		);
	}
	let totalChunks = 0;
	for (const size of chunks.values()) {
		totalChunks = checkedAdd(totalChunks, size, "manifest chunk bytes");
	}
	if (
		totalFiles > MAX_TOTAL_UNCOMPRESSED_BYTES ||
		totalChunks > MAX_TOTAL_UNCOMPRESSED_BYTES
	) {
		throw new SyncCapError(
			`manifest exceeds ${MAX_TOTAL_UNCOMPRESSED_BYTES}-byte uncompressed cap`,
		);
	}
}

async function fetchManifest(
	baseUrl: string,
	pointer: VersionPointer,
	fetchBytes: FetchBytes,
	store: CacheStore,
): Promise<IndexManifest> {
	const raw = await fetchCapped(
		fetchBytes,
		`${baseUrl}/manifest/${pointer.manifest_hash}`,
		MAX_MANIFEST_BYTES,
	);
	if ((await sha256Hex(raw)) !== pointer.manifest_hash) {
		throw new IntegrityError(
			`manifest ${pointer.manifest_hash} failed content-address check`,
		);
	}
	const manifest = parseJson(raw, "manifest");
	assertManifest(manifest, pointer);
	await store.putManifest(raw);
	return manifest;
}

async function missingChunks(
	manifest: IndexManifest,
	store: CacheStore,
): Promise<{
	readonly missing: ReadonlyArray<ChunkRef>;
	readonly reused: number;
}> {
	const wanted = new Map<string, ChunkRef>();
	for (const entry of manifest.files) {
		for (const ref of entry.chunks) wanted.set(ref.hash, ref);
	}
	const missing: ChunkRef[] = [];
	for (const ref of wanted.values()) {
		if (!(await store.hasChunk(ref.hash))) missing.push(ref);
	}
	return { missing, reused: wanted.size - missing.length };
}

function totalFetchLimit(args: SyncArgs): number {
	const requested = args.limits?.maxTotalFetchBytes;
	if (requested === undefined) return MAX_TOTAL_FETCH_BYTES;
	if (!Number.isSafeInteger(requested) || requested < 1) {
		throw new SyncCapError(
			"aggregate fetch cap must be a positive safe integer",
		);
	}
	return Math.min(requested, MAX_TOTAL_FETCH_BYTES);
}

async function fetchMissing(
	baseUrl: string,
	missing: ReadonlyArray<ChunkRef>,
	fetchBytes: FetchBytes,
	store: CacheStore,
	maxTotalBytes: number,
): Promise<number> {
	let next = 0;
	let total = 0;
	let remaining = maxTotalBytes;
	let inFlight = 0;
	const budgetWaiters: Array<() => void> = [];
	let failure: unknown;
	const reserve = async (): Promise<number> => {
		while (remaining === 0 && inFlight > 0 && failure === undefined) {
			await new Promise<void>((resolve) => {
				budgetWaiters.push(resolve);
			});
		}
		if (remaining === 0) return 0;
		const reservation = Math.min(MAX_COMPRESSED_CHUNK_BYTES, remaining);
		remaining -= reservation;
		inFlight += 1;
		return reservation;
	};
	const release = (reservation: number, consumed: number): void => {
		remaining += reservation - consumed;
		inFlight -= 1;
		for (const wake of budgetWaiters.splice(0)) wake();
	};
	const worker = async (): Promise<void> => {
		while (failure === undefined) {
			const ref = missing[next];
			next += 1;
			if (ref === undefined) return;
			const reservation = await reserve();
			if (reservation === 0) {
				failure = new SyncCapError(
					`sync exceeded ${maxTotalBytes}-byte aggregate fetch cap`,
				);
				return;
			}
			let consumed = 0;
			try {
				const compressed = await fetchCapped(
					fetchBytes,
					`${baseUrl}/chunk/${ref.hash}`,
					reservation,
				);
				if (failure !== undefined) return;
				consumed = compressed.byteLength;
				total += consumed;
				await store.putChunkCompressed(ref.hash, compressed, ref.size);
			} catch (error) {
				failure ??=
					error instanceof SyncCapError
						? new SyncCapError(
								`sync exceeded ${maxTotalBytes}-byte aggregate fetch cap`,
							)
						: error;
			} finally {
				release(reservation, consumed);
			}
		}
	};
	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_CONCURRENT_CHUNK_FETCHES, missing.length) },
			worker,
		),
	);
	if (failure !== undefined) throw failure;
	return total;
}

function concat(
	parts: ReadonlyArray<Uint8Array>,
	expected: number,
): Uint8Array {
	const out = new Uint8Array(expected);
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.byteLength;
	}
	return out;
}

async function reassemble(
	entry: FileEntry,
	store: CacheStore,
): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	for (const ref of entry.chunks) {
		parts.push(await store.getChunk(ref.hash, ref.size));
	}
	const blob = concat(parts, entry.size);
	if ((await sha256Hex(blob)) !== entry.file_sha256) {
		throw new IntegrityError(`file ${entry.path} failed reassembly check`);
	}
	return blob;
}

async function verifyReassembly(
	manifest: IndexManifest,
	store: CacheStore,
): Promise<void> {
	for (const entry of manifest.files) await reassemble(entry, store);
}

function distinctChunks(manifest: IndexManifest): number {
	return new Set(
		manifest.files.flatMap((entry) => entry.chunks.map((ref) => ref.hash)),
	).size;
}

async function syncFromCache(
	store: CacheStore,
	args: SyncArgs,
	verify: Verify,
): Promise<SyncResult | null> {
	const active = await store.readActive();
	if (active === null) return null;
	assertVersionPointer(active);
	await verify(pointerSigningBytes(active), active.signature);
	assertExpectedIdentity(active, args);
	const raw = await store.getManifest(active.manifest_hash);
	const manifest = parseJson(raw, "cached manifest");
	assertManifest(manifest, active);
	await verifyReassembly(manifest, store);
	return {
		version: active.version,
		manifestHash: active.manifest_hash,
		chunksFetched: 0,
		chunksReused: distinctChunks(manifest),
		bytesFetched: 0,
	};
}

export async function syncIndex(args: SyncArgs): Promise<SyncResult> {
	const { baseUrl, store, fetchBytes, verify } = args;
	let pointer: VersionPointer;
	try {
		pointer = await fetchPointer(baseUrl, fetchBytes, verify);
	} catch (error) {
		if (error instanceof NetworkError) {
			const cached = await syncFromCache(store, args, verify);
			if (cached !== null) return cached;
		}
		throw error;
	}
	assertExpectedIdentity(pointer, args);
	const active = await store.readActive();
	const refusal = active === null ? null : downgradeReason(pointer, active);
	if (refusal !== null) {
		throw new RollbackError(refusal);
	}
	const manifest = await fetchManifest(baseUrl, pointer, fetchBytes, store);
	const { missing, reused } = await missingChunks(manifest, store);
	const bytesFetched = await fetchMissing(
		baseUrl,
		missing,
		fetchBytes,
		store,
		totalFetchLimit(args),
	);
	await verifyReassembly(manifest, store);
	await store.promote(pointer);
	return {
		version: pointer.version,
		manifestHash: pointer.manifest_hash,
		chunksFetched: missing.length,
		chunksReused: reused,
		bytesFetched,
	};
}

function fileEntry(manifest: IndexManifest, path: string): FileEntry {
	const entry = manifest.files.find((candidate) => candidate.path === path);
	if (entry === undefined) throw new Error(`file ${path} not in manifest`);
	return entry;
}

export async function materializeFile(
	store: CacheStore,
	manifest: IndexManifest,
	path: string,
): Promise<Uint8Array> {
	return reassemble(fileEntry(manifest, path), store);
}
