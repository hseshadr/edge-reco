// @edgeproc/browser/testing — test-only seams.
//
// These are NOT part of the production runtime surface. They expose the
// lower-level sync primitives (in-memory CAS store, the syncIndex state
// machine, materializeFile) and the local fixture loader so that consumers'
// tests can drive an end-to-end sync over the real committed signed bundle
// without a network or a browser. The production app should depend only on
// the package root entrypoint.

// --- node fixture loader (the committed signed bundle ships INSIDE the
//     package; consumers' tests run end-to-end without repo-root files) ---
export * from "./engine/fixtures";
// --- the in-memory content-addressed store ---
export { MemoryCacheStore } from "./engine/memoryStore";
// --- the sync state machine + file reassembly ---
export { materializeFile, syncIndex } from "./engine/sync";
// --- the seam types the production runtime accepts ---
export type {
	CacheStore,
	FetchBytes,
	IndexManifest,
	SyncResult,
	Verify,
	VersionPointer,
} from "./engine/types";
