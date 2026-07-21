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
//
// This file is the SINGLE source of truth for the published performance figures.
// README.md deliberately carries none — landing-figures.test.ts fails if a
// hardcoded timing or heap claim reappears there.

/**
 * Dated reference measurement the tiles above are sanity-checked against.
 *
 * Reproduce it (prints one `release metrics:` line):
 *
 * ```bash
 * cd frontend && pnpm install --frozen-lockfile
 * cd app && pnpm run test:e2e:c1
 * ```
 *
 * Measured 2026-07-20 on macOS 26.5 arm64, Node v24.16.0, headless Chromium
 * (the C1 lane, `tests/e2e-c1/search-quality.spec.ts`):
 *
 *     release metrics: boot=982.2ms search_p50=20.3ms search_p95=23.8ms heap=40.1MiB
 *
 * Headless Chromium is NOT a shopper's browser — it reports a markedly larger
 * heap than a real tab does — so the tiles are not copied from this run. They
 * stay deliberately conservative stand-ins, and the test only asserts they stay
 * within the same order of magnitude (see REFERENCE_TOLERANCE).
 */
export const REFERENCE_MEASUREMENT = {
	date: "2026-07-20",
	environment: "macOS 26.5 arm64, Node v24.16.0, headless Chromium (C1 lane)",
	command: "cd frontend/app && pnpm run test:e2e:c1",
	coldStartMs: 982.2,
	searchP50Ms: 20.3,
	searchP95Ms: 23.8,
	heapMb: 40.1,
} as const;

/**
 * How far a tile may sit from REFERENCE_MEASUREMENT before the test fails.
 *
 * Wide on purpose: the tiles describe a real shopper's browser, the reference
 * run is headless Chromium on one laptop, and a tight band would go red on
 * ordinary machine variance. A flaky guard is worse than no guard. What this
 * DOES catch is the failure that actually happened — a published figure drifting
 * an order of magnitude away from anything measurable.
 */
export const REFERENCE_TOLERANCE = 3;

/** Products in the committed demo catalog. Guarded against the source CSV in tests. */
export const CATALOG_PRODUCTS = 720;
/** Categories the committed catalog is balanced across (see CLAUDE.md invariant). */
export const CATALOG_CATEGORIES = 12;
/** On-disk size of the committed signed bundle (backend/examples/catalog). */
export const BUNDLE_SIZE = "1.6 MB";

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
