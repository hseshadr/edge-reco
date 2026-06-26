// Pure selection logic for which rails to render and how to label them. Keeping
// this out of the React components makes the degrade-to-single-rail rule (a v1
// bundle ships no `strategies` map) and the PDP rail set unit-testable without a
// DOM. Labels always come from the synced strategy map when present, with a
// sensible built-in fallback so the UI never renders an empty title.

import type { Product, Strategy } from "../api/types";

/** A rail the home view wants to render: its strategy key + display label. */
export interface RailSpec {
	readonly strategy: string;
	readonly label: string;
}

const FALLBACK_LABELS: Readonly<Record<string, string>> = {
	for_you: "Recommended for you",
	trending: "Trending now",
	new_arrivals: "New arrivals",
	similar_items: "Similar items",
	because_viewed: "Because you viewed this",
	frequently_bought_together: "Frequently bought together",
	also_bought: "Customers who bought this also bought",
};

const HOME_ORDER: ReadonlyArray<string> = [
	"for_you",
	"trending",
	"new_arrivals",
];

/**
 * The PDP co-occurrence rails, in display order: "Frequently bought together"
 * (placed high, near the hero) then "Customers who bought this also bought"
 * (below). Both are seed-driven co-occurrence strategies — they take no profile
 * and depend only on the seed product. Labels come from the synced strategy map
 * when present, else the built-in literal fallback, so the title is never empty.
 */
const COBUY_ORDER: ReadonlyArray<string> = [
	"frequently_bought_together",
	"also_bought",
];

/** Human label for a strategy: the synced map wins, else a built-in fallback. */
export function labelFor(
	strategy: string,
	strategies: Record<string, Strategy>,
): string {
	return strategies[strategy]?.label ?? FALLBACK_LABELS[strategy] ?? strategy;
}

/**
 * The home stacked rails, in display order. A v1 bundle (empty `strategies`)
 * degrades to the single `for_you` rail — its fallback label always resolves.
 */
export function homeRails(strategies: Record<string, Strategy>): RailSpec[] {
	if (Object.keys(strategies).length === 0) {
		return [
			{ strategy: "for_you", label: FALLBACK_LABELS.for_you ?? "for_you" },
		];
	}
	return HOME_ORDER.filter((key) => strategies[key] !== undefined).map(
		(strategy) => ({ strategy, label: labelFor(strategy, strategies) }),
	);
}

/**
 * The PDP co-occurrence rail specs in display order (FBT first, also-bought
 * second). Always returns both: whether the rail actually renders is decided
 * downstream by `safeResults` — a cold/co-occurrence-less seed yields empty
 * results and the rail is dropped by the PDP.
 */
export function coBuyRails(strategies: Record<string, Strategy>): RailSpec[] {
	return COBUY_ORDER.map((strategy) => ({
		strategy,
		label: labelFor(strategy, strategies),
	}));
}

/**
 * The "Trending in {category}" PDP rail label, derived from the product's
 * category (Title Case). Falls back to plain "Trending now" for a blank
 * category so the title is never half-formed.
 */
export function trendingInCategoryLabel(product: Product): string {
	const category = product.category.trim();
	if (category === "") {
		return FALLBACK_LABELS.trending ?? "Trending now";
	}
	return `Trending in ${titleCase(category)}`;
}

/**
 * Capitalize each word of a category label, splitting on BOTH spaces and hyphens
 * so "personal-care" becomes "Personal-Care", not "Personal-care". Only the first
 * letter of each segment is upper-cased and the rest is left as authored, so an
 * already-uppercase acronym ("GPS") survives instead of being mangled to "Gps".
 * The original whitespace/hyphen separators are preserved verbatim.
 */
function titleCase(text: string): string {
	return text.replace(
		/[^\s-]+/g,
		(word) => word.charAt(0).toUpperCase() + word.slice(1),
	);
}
