// OPFS-backed CacheStore — the browser tier's content-addressed store. Runs in
// a Web Worker (createSyncAccessHandle is Worker-only). Mirrors edge-proc's
// FilesystemCacheStore: chunk/<hash> holds verbatim zstd, manifest/<hash> holds
// the manifest bytes, active holds the promoted VersionPointer. The read path is
// always decompress → re-hash → compare (fail-closed). Store this verbatim so a
// patch re-sync can prove only-changed-chunks were fetched.

import { sha256Hex } from "./crypto";
import { decompressAndVerify, IntegrityError } from "./integrity";
import type { CacheStore, VersionPointer } from "./types";

const CHUNK_DIR = "chunk";
const MANIFEST_DIR = "manifest";
const ACTIVE_FILE = "active";

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

function readHandle(handle: FileSystemSyncAccessHandle): Uint8Array {
	const size = handle.getSize();
	const buffer = new Uint8Array(size);
	handle.read(buffer, { at: 0 });
	return buffer;
}

function writeHandle(
	handle: FileSystemSyncAccessHandle,
	data: Uint8Array,
): void {
	handle.truncate(0);
	handle.write(data, { at: 0 });
	handle.flush();
}

export class OpfsCacheStore implements CacheStore {
	readonly #root: FileSystemDirectoryHandle;
	readonly #chunkDir: FileSystemDirectoryHandle;
	readonly #manifestDir: FileSystemDirectoryHandle;

	private constructor(
		root: FileSystemDirectoryHandle,
		chunkDir: FileSystemDirectoryHandle,
		manifestDir: FileSystemDirectoryHandle,
	) {
		this.#root = root;
		this.#chunkDir = chunkDir;
		this.#manifestDir = manifestDir;
	}

	/** Open (or create) the OPFS store root + chunk/manifest subdirs. */
	public static async open(): Promise<OpfsCacheStore> {
		const root = await navigator.storage.getDirectory();
		const chunkDir = await root.getDirectoryHandle(CHUNK_DIR, { create: true });
		const manifestDir = await root.getDirectoryHandle(MANIFEST_DIR, {
			create: true,
		});
		return new OpfsCacheStore(root, chunkDir, manifestDir);
	}

	public async hasChunk(chunkHash: string): Promise<boolean> {
		try {
			await this.#chunkDir.getFileHandle(chunkHash);
			return true;
		} catch {
			return false;
		}
	}

	public async putChunkCompressed(
		chunkHash: string,
		compressed: Uint8Array,
	): Promise<void> {
		// Verify BEFORE landing it (fail-closed): a bad chunk never reaches OPFS.
		await decompressAndVerify(chunkHash, compressed);
		await this.writeFile(this.#chunkDir, chunkHash, compressed);
	}

	public async getChunk(chunkHash: string): Promise<Uint8Array> {
		const compressed = await this.readFile(this.#chunkDir, chunkHash);
		return decompressAndVerify(chunkHash, compressed);
	}

	public async putManifest(manifestBytes: Uint8Array): Promise<string> {
		const manifestHash = await sha256Hex(manifestBytes);
		await this.writeFile(this.#manifestDir, manifestHash, manifestBytes);
		return manifestHash;
	}

	public async getManifest(manifestHash: string): Promise<Uint8Array> {
		const raw = await this.readFile(this.#manifestDir, manifestHash);
		if ((await sha256Hex(raw)) !== manifestHash) {
			throw new IntegrityError(
				`manifest ${manifestHash} failed content-address check`,
			);
		}
		return raw;
	}

	public async readActive(): Promise<VersionPointer | null> {
		try {
			const raw = await this.readFile(this.#root, ACTIVE_FILE);
			return JSON.parse(DECODER.decode(raw)) as VersionPointer;
		} catch {
			return null;
		}
	}

	public async promote(pointer: VersionPointer): Promise<void> {
		await this.writeFile(
			this.#root,
			ACTIVE_FILE,
			ENCODER.encode(JSON.stringify(pointer)),
		);
	}

	private async writeFile(
		dir: FileSystemDirectoryHandle,
		name: string,
		data: Uint8Array,
	): Promise<void> {
		const fileHandle = await dir.getFileHandle(name, { create: true });
		const handle = await fileHandle.createSyncAccessHandle();
		try {
			writeHandle(handle, data);
		} finally {
			handle.close();
		}
	}

	private async readFile(
		dir: FileSystemDirectoryHandle,
		name: string,
	): Promise<Uint8Array> {
		const fileHandle = await dir.getFileHandle(name);
		const handle = await fileHandle.createSyncAccessHandle();
		try {
			return readHandle(handle);
		} finally {
			handle.close();
		}
	}
}
