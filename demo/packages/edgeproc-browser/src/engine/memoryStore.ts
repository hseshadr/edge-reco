// In-memory CacheStore (Map-backed) implementing the same surface as the OPFS
// store, so the sync state machine is testable without OPFS (per the spec's
// "thin in-memory CacheStore" for pure-logic tests).

import { sha256Hex } from "./crypto";
import { decompressAndVerify, verifyPlaintext } from "./integrity";
import type { CacheStore, VersionPointer } from "./types";

export class MemoryCacheStore implements CacheStore {
	// Chunks are stored as verified plaintext: ingest decompresses + verifies
	// once, reads re-verify the content-address invariant.
	readonly #chunks = new Map<string, Uint8Array>();
	readonly #manifests = new Map<string, Uint8Array>();
	#active: VersionPointer | null = null;

	public hasChunk(chunkHash: string): Promise<boolean> {
		return Promise.resolve(this.#chunks.has(chunkHash));
	}

	public async putChunkCompressed(
		chunkHash: string,
		compressed: Uint8Array,
	): Promise<void> {
		const plaintext = await decompressAndVerify(chunkHash, compressed);
		this.#chunks.set(chunkHash, plaintext);
	}

	public async getChunk(chunkHash: string): Promise<Uint8Array> {
		const plaintext = this.#chunks.get(chunkHash);
		if (plaintext === undefined) {
			throw new Error(`chunk ${chunkHash} not in store`);
		}
		await verifyPlaintext(chunkHash, plaintext);
		return plaintext;
	}

	public async putManifest(manifestBytes: Uint8Array): Promise<string> {
		const manifestHash = await sha256Hex(manifestBytes);
		this.#manifests.set(manifestHash, manifestBytes);
		return manifestHash;
	}

	public getManifest(manifestHash: string): Promise<Uint8Array> {
		const raw = this.#manifests.get(manifestHash);
		if (raw === undefined) {
			throw new Error(`manifest ${manifestHash} not in store`);
		}
		return Promise.resolve(raw);
	}

	public readActive(): Promise<VersionPointer | null> {
		return Promise.resolve(this.#active);
	}

	public promote(pointer: VersionPointer): Promise<void> {
		this.#active = pointer;
		return Promise.resolve();
	}
}
