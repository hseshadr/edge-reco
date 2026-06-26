// Representative figures for the pre-boot Landing page.
//
// The engine isn't running on the landing, so these can't be measured live — the
// in-store MetricsStrip shows the REAL per-session numbers (latency, heap, backend
// calls, cold start, product count). These are honest, clearly-labelled stand-ins.
//
// Everything lives here so no number is duplicated or drifts. The CATALOG_* facts
// are tied to the committed signed bundle (built from
// backend/examples/source/catalog.csv) and CATALOG_PRODUCTS is guarded against
// drift by landing-figures.test.ts.

/** Products in the committed demo catalog. Guarded against the source CSV in tests. */
export const CATALOG_PRODUCTS = 720;
/** Categories the committed catalog is balanced across (see CLAUDE.md invariant). */
export const CATALOG_CATEGORIES = 12;
/** On-disk size of the committed signed bundle (backend/examples/catalog). */
export const BUNDLE_SIZE = "1.6 MB";

export interface RepresentativeMetric {
	num: string;
	unit?: string;
	tone?: "hot" | "pos";
	label: string;
	sub: string;
}

/** The six representative tiles shown in the landing's metric band. */
export const LANDING_METRICS: readonly RepresentativeMetric[] = [
	{
		num: "~36",
		unit: "ms",
		tone: "hot",
		label: "per recommendation",
		sub: "in-tab, no network hop",
	},
	{
		num: "0",
		tone: "pos",
		label: "backend calls after sync",
		sub: "search · recommend · rerank — all local",
	},
	{
		num: "~1.2",
		unit: "s",
		label: "cold start to first results",
		sub: `verify + load ${CATALOG_PRODUCTS} products`,
	},
	{
		num: "~22",
		unit: "MB",
		label: "JS heap (Chromium)",
		sub: "whole engine, in the tab",
	},
	{
		num: "$0",
		tone: "pos",
		label: "inference / 1k recs",
		sub: "illustrative · only CDN bandwidth",
	},
	{
		num: String(CATALOG_PRODUCTS),
		label: "real products, in-tab",
		sub: `${CATALOG_CATEGORIES} categories · ${BUNDLE_SIZE} bundle`,
	},
];

/** Footnote under the landing CTA. */
export const LANDING_FOOTNOTE = `First load fetches a ~${BUNDLE_SIZE} signed bundle + a one-time embedding model, then everything is cached and offline.`;
