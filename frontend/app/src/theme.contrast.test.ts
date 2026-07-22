// WCAG-AA contrast is a PROPERTY of the design tokens, not a snapshot: this
// suite parses the custom properties out of index.css and computes the actual
// WCAG 2.x contrast ratio for every token pair the UI renders as small text.
// If a future palette tweak drops a pair below 4.5:1, this fails with the
// measured ratio instead of letting the regression ship.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "index.css"), "utf8");

/** Custom properties declared on `:root` (first block wins, matching cascade). */
function rootTokens(): Map<string, string> {
	const root = css.match(/:root\s*\{([\s\S]*?)\}/);
	if (root?.[1] === undefined) throw new Error(":root block not found");
	const tokens = new Map<string, string>();
	for (const decl of root[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		const name = decl[1] as string;
		const value = decl[2] as string;
		tokens.set(name, value.trim());
	}
	return tokens;
}

function hexToRgb(hex: string): [number, number, number] {
	const normalized = hex.replace("#", "");
	const full =
		normalized.length === 3
			? [...normalized].map((c) => c + c).join("")
			: normalized;
	const value = Number.parseInt(full, 16);
	return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

/** WCAG 2.x relative luminance from an sRGB hex color. */
function luminance(hex: string): number {
	const [r, g, b] = hexToRgb(hex).map((channel) => {
		const srgb = channel / 255;
		return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
	}) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colors. */
function contrast(foreground: string, background: string): number {
	const lighter = Math.max(luminance(foreground), luminance(background));
	const darker = Math.min(luminance(foreground), luminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

const tokens = rootTokens();

function token(name: string): string {
	const value = tokens.get(name);
	if (value === undefined || !value.startsWith("#")) {
		throw new Error(`token ${name} is missing or not a hex color: ${value}`);
	}
	return value;
}

/** The declarations of a top-level rule, by exact selector. */
function rule(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
	if (match?.[1] === undefined) throw new Error(`rule not found: ${selector}`);
	return match[1];
}

/** The color token a rule paints its text with (must be a `var(--token)`). */
function colorToken(selector: string): string {
	const colorDecl = rule(selector).match(/color:\s*var\((--[\w-]+)\)/);
	if (colorDecl?.[1] === undefined) {
		throw new Error(`${selector} color must come from a token`);
	}
	return colorDecl[1];
}

describe("design-token WCAG-AA contrast", () => {
	// --muted renders 12-14px body text on both paper surfaces (~40 call sites).
	it.each([
		["--muted", "--paper"],
		["--muted", "--paper-raise"],
	])("%s on %s meets 4.5:1", (fg, bg) => {
		const ratio = contrast(token(fg), token(bg));
		expect(
			ratio,
			`${fg} on ${bg} measured ${ratio.toFixed(2)}:1`,
		).toBeGreaterThanOrEqual(4.5);
	});

	// Small text painted with the hot signal family: the 14px metric values on
	// the metrics-strip tiles (--paper surface) and the 12px hover "pick" cue on
	// product cards (--paper-raise surface). Whatever token those rules resolve
	// to must hold WCAG-AA 4.5:1 for small text — the hot --signal itself does
	// not, which is exactly what --signal-ink exists for.
	it.each([
		[".metrics-strip__value", "--paper"],
		[".card__pick", "--paper-raise"],
	])("small text in %s meets 4.5:1 on %s", (selector, bg) => {
		const ratio = contrast(token(colorToken(selector)), token(bg));
		expect(
			ratio,
			`${selector} measured ${ratio.toFixed(2)}:1 against ${bg}`,
		).toBeGreaterThanOrEqual(4.5);
	});
});

describe("footer link-in-text-block accessibility", () => {
	it("renders footer links at >=4.5:1 against the page background", () => {
		const ratio = contrast(
			token(colorToken(".nimbus-footer__link")),
			token("--paper"),
		);
		expect(
			ratio,
			`footer link measured ${ratio.toFixed(2)}:1`,
		).toBeGreaterThanOrEqual(4.5);
	});

	it("underlines footer links so links-in-text do not rely on color alone", () => {
		expect(rule(".nimbus-footer__link")).toMatch(
			/text-decoration:\s*underline/,
		);
	});
});
