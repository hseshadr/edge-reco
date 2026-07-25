// Deterministic category → editorial-tile style resolution. The catalog ships
// compound Amazon category names ("Clothing, Shoes & Jewelry", "Tools & Home
// Improvement"), so exact-key lookup would send almost everything to the
// default tile. Instead each style claims a few normalized keywords and the
// FIRST match wins — order matters ("Tools & Home Improvement" must hit
// `tool` before `home` claims it for Home & Kitchen). The default "Catalog"
// tile is the exception for genuinely unknown categories, not the norm.

export interface CategoryStyle {
	readonly className: string;
	readonly glyph: string;
	readonly label: string;
}

export const DEFAULT_STYLE: CategoryStyle = {
	className: "pimg-tile--default",
	glyph: "\u{2728}",
	label: "Catalog",
};

interface KeywordStyle {
	readonly keywords: ReadonlyArray<string>;
	readonly style: CategoryStyle;
}

/** Ordered first-match table covering the bundled Amazon taxonomy. */
const KEYWORD_STYLES: ReadonlyArray<KeywordStyle> = [
	{
		keywords: ["phone", "cell"],
		style: {
			className: "pimg-tile--phones",
			glyph: "\u{1F4F1}",
			label: "Phones",
		},
	},
	{
		keywords: ["electronic"],
		style: {
			className: "pimg-tile--electronics",
			glyph: "\u{1F50C}",
			label: "Electronics",
		},
	},
	{
		keywords: ["cloth", "shoe", "jewelry", "apparel"],
		style: {
			className: "pimg-tile--clothing",
			glyph: "\u{1F9E5}",
			label: "Clothing",
		},
	},
	// Before `home`: "Tools & Home Improvement" belongs here, not in Home & Kitchen.
	{
		keywords: ["tool", "improvement"],
		style: {
			className: "pimg-tile--tools",
			glyph: "\u{1F527}",
			label: "Tools",
		},
	},
	{
		keywords: ["kitchen", "home"],
		style: {
			className: "pimg-tile--home",
			glyph: "\u{1FAB4}",
			label: "Home",
		},
	},
	{
		keywords: ["sport", "outdoor"],
		style: {
			className: "pimg-tile--sports",
			glyph: "\u{26BD}",
			label: "Sports",
		},
	},
	{
		keywords: ["book"],
		style: {
			className: "pimg-tile--books",
			glyph: "\u{1F4DA}",
			label: "Books",
		},
	},
	{
		keywords: ["auto", "vehicle"],
		style: {
			className: "pimg-tile--automotive",
			glyph: "\u{1F698}",
			label: "Automotive",
		},
	},
	{
		keywords: ["craft", "sewing", "arts"],
		style: {
			className: "pimg-tile--crafts",
			glyph: "\u{1F9F5}",
			label: "Crafts",
		},
	},
	{
		keywords: ["health", "household"],
		style: {
			className: "pimg-tile--health",
			glyph: "\u{1F33F}",
			label: "Health",
		},
	},
	{
		keywords: ["office"],
		style: {
			className: "pimg-tile--office",
			glyph: "\u{1F4CE}",
			label: "Office",
		},
	},
	{
		keywords: ["garden", "lawn", "patio"],
		style: {
			className: "pimg-tile--garden",
			glyph: "\u{1F331}",
			label: "Garden",
		},
	},
	{
		keywords: ["pet"],
		style: {
			className: "pimg-tile--pets",
			glyph: "\u{1F43E}",
			label: "Pets",
		},
	},
];

/** Resolve a catalog category to its tile style (first keyword match wins). */
export function styleForCategory(category: string): CategoryStyle {
	const normalized = category.trim().toLowerCase();
	if (normalized === "") return DEFAULT_STYLE;
	for (const { keywords, style } of KEYWORD_STYLES) {
		if (keywords.some((keyword) => normalized.includes(keyword))) {
			return style;
		}
	}
	return DEFAULT_STYLE;
}

const TONE_CLASSES = ["", "pimg-tile--tone-b", "pimg-tile--tone-c"] as const;

/**
 * Deterministic per-product tone variant ("" = base gradient) so a
 * single-category grid reads as a textured collection, not one flat color.
 */
export function toneClassFor(productId: string): string {
	let hash = 0;
	for (const char of productId) {
		hash = (hash * 31 + (char.codePointAt(0) ?? 0)) >>> 0;
	}
	return TONE_CLASSES[hash % TONE_CLASSES.length] ?? "";
}
