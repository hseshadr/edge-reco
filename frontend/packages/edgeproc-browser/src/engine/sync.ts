// TS port of edgeproc.bundles.sync.sync_index — the same numbered state machine
// against a CacheStore, transport injected as fetchBytes and signature checks as
// verify. Fail-closed: any integrity/signature failure throws and promotes nothing.

import { canonicalBytes, type JsonValue } from "./canonical";
import { sha256Hex } from "./crypto";
import { NetworkError } from "./fetchBytes";
import { IntegrityError } from "./integrity";
import type {
	CacheStore,
	FetchBytes,
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
}

const DECODER = new TextDecoder();

function parseJson<T>(bytes: Uint8Array): T {
	return JSON.parse(DECODER.decode(bytes)) as T;
}

/** Fetch `/latest` and verify its detached signature (fail-closed). */
async function fetchPointer(
	baseUrl: string,
	fetchBytes: FetchBytes,
	verify: Verify,
): Promise<VersionPointer> {
	const pointer = parseJson<VersionPointer>(
		await fetchBytes(`${baseUrl}/latest`),
	);
	const message = canonicalBytes(pointer as unknown as JsonValue, {
		exclude: { signature: true },
	});
	await verify(message, pointer.signature);
	return pointer;
}

/** Fetch the manifest, verify it hashes to the pointer, parse + cache it. */
async function fetchManifest(
	baseUrl: string,
	pointer: VersionPointer,
	fetchBytes: FetchBytes,
	store: CacheStore,
): Promise<IndexManifest> {
	const raw = await fetchBytes(`${baseUrl}/manifest/${pointer.manifest_hash}`);
	if ((await sha256Hex(raw)) !== pointer.manifest_hash) {
		throw new IntegrityError(
			`manifest ${pointer.manifest_hash} failed content-address check`,
		);
	}
	await store.putManifest(raw);
	return parseJson<IndexManifest>(raw);
}

/** Return [chunks to fetch, reused count] over the manifest's deduped chunk set. */
async function missingChunks(
	manifest: IndexManifest,
	store: CacheStore,
): Promise<{
	readonly missing: ReadonlyArray<string>;
	readonly reused: number;
}> {
	const wanted = new Set<string>();
	for (const entry of manifest.files) {
		for (const ref of entry.chunks) {
			wanted.add(ref.hash);
		}
	}
	const missing: string[] = [];
	for (const hash of wanted) {
		if (!(await store.hasChunk(hash))) {
			missing.push(hash);
		}
	}
	return { missing, reused: wanted.size - missing.length };
}

/** Fetch + verbatim-ingest each missing chunk (fail-closed); return bytes fetched. */
async function fetchMissing(
	baseUrl: string,
	missing: ReadonlyArray<string>,
	fetchBytes: FetchBytes,
	store: CacheStore,
): Promise<number> {
	let bytesFetched = 0;
	for (const chunkHash of missing) {
		const compressed = await fetchBytes(`${baseUrl}/chunk/${chunkHash}`);
		await store.putChunkCompressed(chunkHash, compressed);
		bytesFetched += compressed.byteLength;
	}
	return bytesFetched;
}

function concat(parts: ReadonlyArray<Uint8Array>): Uint8Array {
	const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
	const out = new Uint8Array(total);
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
		parts.push(await store.getChunk(ref.hash));
	}
	const blob = concat(parts);
	if ((await sha256Hex(blob)) !== entry.file_sha256) {
		throw new IntegrityError(`file ${entry.path} failed reassembly check`);
	}
	return blob;
}

/** Reassembly-on-read check: each file's chunks concat to its file_sha256. */
async function verifyReassembly(
	manifest: IndexManifest,
	store: CacheStore,
): Promise<void> {
	for (const entry of manifest.files) {
		await reassemble(entry, store);
	}
}

/** Count the distinct chunk hashes a manifest references (for the cache result). */
function distinctChunks(manifest: IndexManifest): number {
	const seen = new Set<string>();
	for (const entry of manifest.files) {
		for (const ref of entry.chunks) {
			seen.add(ref.hash);
		}
	}
	return seen.size;
}

/**
 * Offline fallback: the pointer fetch was network-unreachable. If a previously
 * promoted active version + its manifest are already cached, serve THAT version
 * (0 fetched, all reused) instead of failing. Returns null when no usable cache
 * exists, so the caller re-throws the original network error. Fail-closed: this
 * path runs ONLY for a NetworkError — integrity/signature failures never reach
 * here, so a tampered-but-present pointer still throws.
 */
async function syncFromCache(store: CacheStore): Promise<SyncResult | null> {
	const active = await store.readActive();
	if (active === null) {
		return null;
	}
	const raw = await store.getManifest(active.manifest_hash);
	const manifest = parseJson<IndexManifest>(raw);
	await verifyReassembly(manifest, store);
	return {
		version: active.version,
		manifestHash: active.manifest_hash,
		chunksFetched: 0,
		chunksReused: distinctChunks(manifest),
		bytesFetched: 0,
	};
}

/** Pull a signed pointer, diff + fetch missing chunks, verify, atomically promote. */
export async function syncIndex(args: SyncArgs): Promise<SyncResult> {
	const { baseUrl, store, fetchBytes, verify } = args;
	let pointer: VersionPointer;
	try {
		pointer = await fetchPointer(baseUrl, fetchBytes, verify);
	} catch (error) {
		// Only network-unreachable triggers the cached-version fallback. A present
		// but invalid pointer (bad signature) is an IntegrityError-class failure
		// and must propagate, promoting nothing.
		if (error instanceof NetworkError) {
			const cached = await syncFromCache(store);
			if (cached !== null) {
				return cached;
			}
		}
		throw error;
	}
	const manifest = await fetchManifest(baseUrl, pointer, fetchBytes, store);
	const { missing, reused } = await missingChunks(manifest, store);
	const bytesFetched = await fetchMissing(baseUrl, missing, fetchBytes, store);
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
	for (const entry of manifest.files) {
		if (entry.path === path) {
			return entry;
		}
	}
	throw new Error(`file ${path} not in manifest`);
}

/** Reassemble a synced file's bytes on demand from its chunks (fail-closed). */
export async function materializeFile(
	store: CacheStore,
	manifest: IndexManifest,
	path: string,
): Promise<Uint8Array> {
	return reassemble(fileEntry(manifest, path), store);
}
