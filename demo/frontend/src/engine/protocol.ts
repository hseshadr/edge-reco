// Typed postMessage envelopes between the main thread and the Worker. The Worker
// owns OPFS + the sync engine; the main thread only sends requests + awaits
// replies. Discriminated unions on `kind` / `ok` keep the bridge type-safe.

import type { SyncResult } from "./types";

/** Sync the signed bundle at `baseUrl`, pinning the raw pubkey at `pubkeyUrl`. */
export interface SyncRequest {
	readonly kind: "sync";
	readonly id: number;
	readonly baseUrl: string;
	readonly pubkeyUrl: string;
}

/** Materialize a synced file's bytes from the active manifest. */
export interface ReadFileRequest {
	readonly kind: "readFile";
	readonly id: number;
	readonly path: string;
}

export type EngineRequest = SyncRequest | ReadFileRequest;

interface SyncOk {
	readonly ok: true;
	readonly id: number;
	readonly kind: "sync";
	readonly result: SyncResult;
}

interface ReadFileOk {
	readonly ok: true;
	readonly id: number;
	readonly kind: "readFile";
	readonly bytes: Uint8Array;
}

interface EngineErr {
	readonly ok: false;
	readonly id: number;
	readonly error: string;
}

export type EngineResponse = SyncOk | ReadFileOk | EngineErr;
