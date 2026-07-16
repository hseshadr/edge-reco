// OPFS-backed CacheStore — the browser tier's content-addressed store. Runs in
// a Web Worker (createSyncAccessHandle is Worker-only). Mirrors edge-proc's
// FilesystemCacheStore: chunk/<hash> holds verbatim zstd, manifest/<hash> holds
// the manifest bytes, and two durable active slots hold promoted pointers. A
// torn write leaves the other slot as the monotonic floor. The read path is
// always decompress → re-hash → compare (fail-closed). Store this verbatim so a
// patch re-sync can prove only-changed-chunks were fetched.

import { sha256Hex } from "./crypto";
import { decompressAndVerify, IntegrityError } from "./integrity";
import type { CacheStore, VersionPointer } from "./types";

const CHUNK_DIR = "chunk";
const MANIFEST_DIR = "manifest";
const ACTIVE_FILE = "active";
const ACTIVE_SLOTS = ["active.a", "active.b"] as const;
const MUTATION_LOCK = "mutation.lock";
const MAX_ACTIVE_BYTES = 16 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_COMPRESSED_CHUNK_BYTES = 2 * 1024 * 1024;

const DECODER = new TextDecoder();
const ENCODER = new TextEncoder();

/** Select the newest structurally valid durable pointer after a torn write. */
export function selectHighestPointer(
	candidates: ReadonlyArray<VersionPointer | null>,
): VersionPointer | null {
	let highest: VersionPointer | null = null;
	for (const candidate of candidates) {
		if (
			candidate === null ||
			!Number.isSafeInteger(candidate.sequence) ||
			candidate.sequence < 0
		) {
			continue;
		}
		if (highest === null || candidate.sequence > highest.sequence) {
			highest = candidate;
		}
	}
	return highest;
}

/** A promotion may only advance the durable identity, never fork it. */
export function canPromotePointer(
	current: VersionPointer | null,
	incoming: VersionPointer,
): boolean {
	if (current === null || incoming.sequence > current.sequence) return true;
	if (incoming.sequence < current.sequence) return false;
	return (
		incoming.manifest_hash === current.manifest_hash &&
		incoming.version === current.version &&
		(incoming.bundle_id ?? null) === (current.bundle_id ?? null) &&
		(incoming.channel ?? null) === (current.channel ?? null)
	);
}

function readHandle(
	handle: FileSystemSyncAccessHandle,
	maxBytes: number,
): Uint8Array {
	const size = handle.getSize();
	if (size > maxBytes) {
		throw new IntegrityError(
			`OPFS object is ${size} bytes, over the ${maxBytes}-byte read cap`,
		);
	}
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
		expectedSize: number,
	): Promise<void> {
		if (compressed.byteLength > MAX_COMPRESSED_CHUNK_BYTES) {
			throw new IntegrityError("compressed chunk exceeds the OPFS read cap");
		}
		// Verify BEFORE landing it (fail-closed): a bad chunk never reaches OPFS.
		await decompressAndVerify(chunkHash, compressed, expectedSize);
		await this.writeFile(this.#chunkDir, chunkHash, compressed);
	}

	public async getChunk(
		chunkHash: string,
		expectedSize: number,
	): Promise<Uint8Array> {
		const compressed = await this.readFile(
			this.#chunkDir,
			chunkHash,
			MAX_COMPRESSED_CHUNK_BYTES,
		);
		try {
			return await decompressAndVerify(chunkHash, compressed, expectedSize);
		} catch (err) {
			// Self-heal: a stored object that fails its content-address check is
			// corrupt (partial write / bit-rot). Evict it so `hasChunk` goes false
			// and the next `syncIndex` re-fetches it — otherwise one bad chunk
			// poisons every load forever. The read still fails closed (rethrow).
			if (err instanceof IntegrityError) {
				await this.evict(this.#chunkDir, chunkHash);
			}
			throw err;
		}
	}

	/** Best-effort delete of a corrupt cache object; a concurrent eviction is fine. */
	private async evict(
		dir: FileSystemDirectoryHandle,
		name: string,
	): Promise<void> {
		try {
			await dir.removeEntry(name);
		} catch {
			// Already gone (removed by a racing read or never landed) — nothing to heal.
		}
	}

	public async putManifest(manifestBytes: Uint8Array): Promise<string> {
		if (manifestBytes.byteLength > MAX_MANIFEST_BYTES) {
			throw new IntegrityError("manifest exceeds the OPFS read cap");
		}
		const manifestHash = await sha256Hex(manifestBytes);
		await this.writeFile(this.#manifestDir, manifestHash, manifestBytes);
		return manifestHash;
	}

	public async getManifest(manifestHash: string): Promise<Uint8Array> {
		const raw = await this.readFile(
			this.#manifestDir,
			manifestHash,
			MAX_MANIFEST_BYTES,
		);
		if ((await sha256Hex(raw)) !== manifestHash) {
			throw new IntegrityError(
				`manifest ${manifestHash} failed content-address check`,
			);
		}
		return raw;
	}

	public async readActive(): Promise<VersionPointer | null> {
		const candidates = await Promise.all(
			[ACTIVE_FILE, ...ACTIVE_SLOTS].map((name) => this.readPointer(name)),
		);
		return selectHighestPointer(candidates);
	}

	public async promote(pointer: VersionPointer): Promise<void> {
		await this.withMutationLock(async () => {
			const current = await this.readSlotPointers();
			const highest = selectHighestPointer(current.map((item) => item.pointer));
			if (!canPromotePointer(highest, pointer)) {
				throw new Error(
					`refusing to promote sequence ${pointer.sequence} over durable pointer`,
				);
			}
			const activeSlot = current.find(
				(item) => item.pointer?.sequence === highest?.sequence,
			);
			const target =
				activeSlot?.name === ACTIVE_SLOTS[0]
					? ACTIVE_SLOTS[1]
					: ACTIVE_SLOTS[0];
			await this.writeFile(
				this.#root,
				target,
				ENCODER.encode(JSON.stringify(pointer)),
			);
		});
	}

	private async readPointer(name: string): Promise<VersionPointer | null> {
		try {
			const raw = await this.readFile(this.#root, name, MAX_ACTIVE_BYTES);
			const value: unknown = JSON.parse(DECODER.decode(raw));
			if (typeof value !== "object" || value === null || Array.isArray(value)) {
				return null;
			}
			const pointer = value as VersionPointer;
			return Number.isSafeInteger(pointer.sequence) && pointer.sequence >= 0
				? pointer
				: null;
		} catch {
			return null;
		}
	}

	private async readSlotPointers(): Promise<
		ReadonlyArray<{
			readonly name: string;
			readonly pointer: VersionPointer | null;
		}>
	> {
		return Promise.all(
			ACTIVE_SLOTS.map(async (name) => ({
				name,
				pointer: await this.readPointer(name),
			})),
		);
	}

	private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
		const lockFile = await this.#root.getFileHandle(MUTATION_LOCK, {
			create: true,
		});
		let lock: FileSystemSyncAccessHandle | undefined;
		for (let attempt = 0; attempt < 50 && lock === undefined; attempt += 1) {
			try {
				lock = await lockFile.createSyncAccessHandle();
			} catch {
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		}
		if (lock === undefined) {
			throw new Error("timed out acquiring OPFS mutation lock");
		}
		try {
			return await operation();
		} finally {
			lock.close();
		}
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
		maxBytes: number,
	): Promise<Uint8Array> {
		const fileHandle = await dir.getFileHandle(name);
		const handle = await fileHandle.createSyncAccessHandle();
		try {
			return readHandle(handle, maxBytes);
		} finally {
			handle.close();
		}
	}
}
