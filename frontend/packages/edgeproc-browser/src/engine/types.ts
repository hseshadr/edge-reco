// TS mirrors of edge-proc's bundle models (edgeproc/bundles/manifest.py).
// Interface-over-type for object shapes; the JSON wire format is identical
// across the native (Python) and browser tiers — this is the same manifest.

/** One content-defined chunk: `hash` is the bare hex sha256 of its plaintext. */
export interface ChunkRef {
	readonly hash: string;
	/** Uncompressed chunk length in bytes. */
	readonly size: number;
}

/** A file as an ordered list of chunks (order = reassembly order). */
export interface FileEntry {
	readonly path: string;
	readonly file_type: string | null;
	/** Total uncompressed file length. */
	readonly size: number;
	/** Bare hex sha256 of the whole reassembled file. */
	readonly file_sha256: string;
	readonly chunks: ReadonlyArray<ChunkRef>;
}

/** v2 chunked manifest; authenticated by its content hash, not an embedded sig. */
export interface IndexManifest {
	readonly schema_version: number;
	readonly bundle_id: string;
	readonly version: string;
	readonly files: ReadonlyArray<FileEntry>;
	readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/** Signed pointer to a manifest; `signature` is detached over the rest. */
export interface VersionPointer {
	/** Hex sha256 of the manifest's canonical bytes. */
	readonly manifest_hash: string;
	readonly version: string;
	/** ed25519 over canonicalBytes(self, exclude {signature}), base64. */
	readonly signature: string;
}

/** Outcome of a `syncIndex` run — proves only-changed-chunks were fetched. */
export interface SyncResult {
	readonly version: string;
	readonly manifestHash: string;
	readonly chunksFetched: number;
	readonly chunksReused: number;
	readonly bytesFetched: number;
}

/**
 * Local content-addressed store. The OPFS-backed and in-memory implementations
 * share this surface — the seam edge-proc's `cas.py` `CacheStore` Protocol names.
 */
export interface CacheStore {
	hasChunk(chunkHash: string): Promise<boolean>;
	/** Decompress → sha256 → verify == chunkHash (fail-closed) → store. */
	putChunkCompressed(chunkHash: string, compressed: Uint8Array): Promise<void>;
	/** Read → decompress → verify == chunkHash (fail-closed) → return plaintext. */
	getChunk(chunkHash: string): Promise<Uint8Array>;
	putManifest(manifestBytes: Uint8Array): Promise<string>;
	getManifest(manifestHash: string): Promise<Uint8Array>;
	readActive(): Promise<VersionPointer | null>;
	promote(pointer: VersionPointer): Promise<void>;
}

/** Transport seam: fetch raw bytes for a URL (injectable for tests). */
export type FetchBytes = (url: string) => Promise<Uint8Array>;

/** Fail-closed ed25519 verifier: resolves on a valid signature, else throws. */
export type Verify = (
	message: Uint8Array,
	signatureBase64: string,
) => Promise<void>;
