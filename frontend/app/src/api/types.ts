// The demo's view of the engine's domain contract. The canonical source of
// these types is the @edgeproc/browser package (the engine owns the shapes it
// produces); this module re-exports them so the demo's components and data
// layer keep importing from a single local path while the package stays the one
// source of truth.

export type {
	BrowseResponse,
	CandidatePolicy,
	EventType,
	InteractionEvent,
	Product,
	RecommendResponse,
	ScoreComponents,
	SearchResponse,
	SearchResult,
	Strategy,
} from "@edgeproc/browser";
