import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Locale-parity gate. English is authoritative; every OTHER locale must cover the
// exact same key set, per namespace. With only `en` present this validates the
// baseline layout + non-empty namespaces; the moment a second locale directory is
// added it is auto-enforced against en — no edit to this test required, which is
// what makes "add a locale" a copy-paste.

const LOCALES_DIR = dirname(fileURLToPath(import.meta.url));
const BASE = "en";
const EXPECTED_NAMESPACES = ["common", "errors", "landing", "storefront"];

type Catalog = Record<string, unknown>;

function loadNamespace(locale: string, ns: string): Catalog {
	const raw = readFileSync(join(LOCALES_DIR, locale, `${ns}.json`), "utf8");
	return JSON.parse(raw) as Catalog;
}

/** Flatten a catalog into its dotted leaf-key paths. */
function keys(value: unknown, prefix = ""): string[] {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return Object.entries(value as Catalog).flatMap(([k, v]) =>
			keys(v, prefix ? `${prefix}.${k}` : k),
		);
	}
	return [prefix];
}

const localeDirs = readdirSync(LOCALES_DIR, { withFileTypes: true })
	.filter((entry) => entry.isDirectory())
	.map((entry) => entry.name);

const namespaces = readdirSync(join(LOCALES_DIR, BASE))
	.filter((file) => file.endsWith(".json"))
	.map((file) => file.replace(/\.json$/, ""))
	.sort();

describe("i18n locale parity", () => {
	it("ships the English baseline with the expected namespaces", () => {
		expect(localeDirs).toContain(BASE);
		expect(namespaces).toEqual(EXPECTED_NAMESPACES);
	});

	it("has at least one key in every en namespace", () => {
		for (const ns of namespaces) {
			expect(keys(loadNamespace(BASE, ns)).length).toBeGreaterThan(0);
		}
	});

	for (const locale of localeDirs.filter((dir) => dir !== BASE)) {
		for (const ns of namespaces) {
			it(`${locale}/${ns} matches the en key set exactly`, () => {
				const enKeys = keys(loadNamespace(BASE, ns)).sort();
				const localeKeys = keys(loadNamespace(locale, ns)).sort();
				expect(localeKeys).toEqual(enKeys);
			});
		}
	}
});
