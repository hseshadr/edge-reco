// Representative figures for the pre-boot Landing page.
//
// The engine isn't running on the landing, so these can't be measured live — the
// in-store MetricsStrip shows the REAL per-session numbers (latency, heap, backend
// calls, cold start, product count). These are honest, clearly-labelled stand-ins.
//
// The NUMBERS live here so no figure is duplicated or drifts (the CATALOG_* facts
// are tied to the committed signed bundle, built from
// backend/examples/source/catalog.csv, and CATALOG_PRODUCTS is guarded against
// drift by landing-figures.test.ts). The COPY — labels, subs, footnote — lives in
// the `landing` i18n namespace and is resolved by Landing.tsx via each tile's
// stable `id`, so the two never drift apart either.

/** Products in the committed demo catalog. Guarded against the source CSV in tests. */
export const CATALOG_PRODUCTS = 720;
/** Categories the committed catalog is balanced across (see CLAUDE.md invariant). */
export const CATALOG_CATEGORIES = 12;
/** On-disk size of the committed signed bundle (backend/examples/catalog). */
export const BUNDLE_SIZE = "2.2 MB";

export interface RepresentativeMetric {
	/** Stable key into the `landing` namespace: `metrics.<id>.{label,sub}`. */
	id: string;
	num: string;
	unit?: string;
	tone?: "hot" | "pos";
	/** Interpolation values for the tile's `sub` copy (never reserved `count`). */
	vars?: Record<string, string | number>;
}

/** The six representative tiles shown in the landing's metric band. */
export const LANDING_METRICS: readonly RepresentativeMetric[] = [
	{ id: "latency", num: "~36", unit: "ms", tone: "hot" },
	{ id: "backendCalls", num: "0", tone: "pos" },
	{
		id: "coldStart",
		num: "~1.2",
		unit: "s",
		vars: { products: CATALOG_PRODUCTS },
	},
	{ id: "heap", num: "~22", unit: "MB" },
	{ id: "cost", num: "$0", tone: "pos" },
	{
		id: "catalog",
		num: String(CATALOG_PRODUCTS),
		vars: { categories: CATALOG_CATEGORIES, bundle: BUNDLE_SIZE },
	},
];
