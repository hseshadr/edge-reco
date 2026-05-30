// @edgeproc/browser/engine — the reusable, domain-agnostic sync tier.
//
// This is the PRODUCTION surface for building a new in-browser edge-proc
// consumer. It syncs a signed, content-addressed bundle into OPFS (ed25519 +
// sha256, fail-closed), reassembles files, and runs the sync entirely in a Web
// Worker — with ZERO domain coupling (no search, no embeddings, no astrology).
//
// The pattern: spawn an `EngineClient`, `sync()` a bundle, `readFile()` the
// synced assets, then run your OWN compute over them. edge-reco layers hybrid
// search on top (see the package root `.` entrypoint); AlmaMesh layers a Pyodide
// chart engine on top. Both share this one wire format and one trust root.
//
// (The package root `.` export is edge-reco's search domain; `./testing` is the
// browser-safe test seam. This `engine` subpath is the stable reuse contract.)

// --- the Worker-backed sync client: spawn -> sync -> readFile -> terminate ---
export { EngineClient } from "./engine/client";
// --- fail-closed crypto primitives (compose your own Verify if needed) ---
export { SignatureError, sha256Hex, verifyEd25519 } from "./engine/crypto";
// --- the default byte fetcher (swap for custom transport/headers) ---
export { fetchBytes } from "./engine/fetchBytes";
export { MemoryCacheStore } from "./engine/memoryStore";
// --- content-addressed stores: OPFS for production, in-memory for tests ---
export { OpfsCacheStore } from "./engine/opfsStore";
// --- the main<->worker postMessage wire contract ---
export type {
	EngineRequest,
	EngineResponse,
	ReadFileRequest,
	SyncRequest,
} from "./engine/protocol";
// --- the sync state machine + on-demand file reassembly (verified) ---
export { materializeFile, syncIndex } from "./engine/sync";
// --- the seam types a consumer's runtime + worker accept ---
export type {
	CacheStore,
	ChunkRef,
	FetchBytes,
	FileEntry,
	IndexManifest,
	SyncResult,
	Verify,
	VersionPointer,
} from "./engine/types";
