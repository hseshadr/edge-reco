// @edgeproc/browser — the in-browser tier of edge-proc.
//
// Sync a signed, content-addressed bundle into OPFS (ed25519 + sha256, fail-
// closed), reassemble its index files, and run hybrid search (BM25 ⊕ vector →
// RRF → session rerank) entirely in the tab — no backend. The native (Python)
// producer and this browser consumer share one wire format and one domain
// contract (see ./engine/domain).
//
// Primary entry point: EngineRuntime.bootstrap() → SearchEngine.
//
// Low-level sync primitives + the local fixture loader live behind the
// `@edgeproc/browser/testing` subpath. They are test-only seams and not part
// of the production surface.

// --- the Worker-backed sync client (used by the Playwright C1 harness) ---
export { EngineClient } from "./engine/client";
// --- the engine-owned domain contract (single source of truth) ---
export type {
	BrowseResponse,
	EventType,
	InteractionEvent,
	Product,
	RecommendResponse,
	ScoreComponents,
	SearchResponse,
	SearchResult,
} from "./engine/domain";
// --- the embedder seam (transformers.js in production, stubbable in tests) ---
export {
	EMBEDDING_DIM,
	EMBEDDING_MODEL,
	type Embedder,
} from "./engine/embedder";
// --- runtime: bootstrap the engine over the synced bundle ---
export {
	type BootStage,
	configFromEnv,
	createEmbedder,
	defaultRuntimeDeps,
	type EnginePort,
	EngineRuntime,
	type OnStage,
	type RuntimeConfig,
	type RuntimeDeps,
} from "./engine/runtime";
// --- the search surface + its option/return contracts ---
export {
	type BrowseOptions,
	createSearchEngine,
	type RecommendOptions,
	type SearchEngine,
	type SearchOptions,
} from "./engine/searchEngine";
// --- the in-tab session profile, folded forward by interaction events ---
export {
	applyInteraction,
	buildProfile,
	emptyProfile,
	type SessionProfile,
} from "./engine/session";
// --- the SyncResult shape leaks through BootStage; expose its type only ---
export type { SyncResult } from "./engine/types";
