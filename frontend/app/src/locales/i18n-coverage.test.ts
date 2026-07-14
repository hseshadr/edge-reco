import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	auditAll,
	auditSource,
	COMPONENTS_DIR,
} from "../../scripts/i18n-static-audit.mjs";

// The static half of the i18n gate (the live half is scripts/verify-i18n.mjs,
// which drives only the pre-boot Landing). This proves the BOOTED storefront —
// the surface the live gate never reaches — carries no bare user-facing copy,
// so a future un-extracted string trips `pnpm test` in CI instead of shipping.

const SRC_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

describe("i18n static coverage — booted storefront", () => {
	it("has no bare user-facing copy in the audited components", () => {
		expect(auditAll(COMPONENTS_DIR)).toEqual({});
	});

	it("would fail on an un-extracted string (guards the gate itself)", () => {
		// A regression planted into a copy of an audited component MUST be caught,
		// so the gate cannot silently rot into a no-op.
		const planted = `import { useTranslation } from "react-i18next";
export function Demo() {
	const { t } = useTranslation("storefront");
	return <div>{t("grid.empty")}<span>Checkout now, friend</span></div>;
}`;
		const findings = auditSource("Demo.tsx", planted);
		expect(findings.map((f) => f.text)).toContain("Checkout now, friend");
	});
});

// Flatten a catalog object into its dotted leaf-key paths.
function keys(value: unknown, prefix = ""): string[] {
	if (value !== null && typeof value === "object" && !Array.isArray(value)) {
		return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
			keys(v, prefix ? `${prefix}.${k}` : k),
		);
	}
	return [prefix];
}

// Concatenated non-test app source — the corpus a key must appear in to be "used".
function appSource(): string {
	const out: string[] = [];
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (
				/\.(ts|tsx)$/.test(entry.name) &&
				!/\.test\.(ts|tsx)$/.test(entry.name)
			)
				out.push(readFileSync(full, "utf8"));
		}
	};
	walk(SRC_DIR);
	return out.join("\n");
}

// A key is "used" if its base path (plural suffix stripped) appears verbatim, or
// its parent prefix appears — covering dynamic `t(\`why.signals.${x}\`)` lookups.
function isUsed(key: string, corpus: string): boolean {
	const base = key.replace(/_(zero|one|two|few|many|other|plural)$/, "");
	if (corpus.includes(base)) return true;
	const parent = base.slice(0, base.lastIndexOf(".") + 1);
	return parent !== "" && corpus.includes(parent);
}

describe("i18n catalog has no orphan storefront keys", () => {
	const corpus = appSource();
	const storefront = keys(
		JSON.parse(
			readFileSync(join(SRC_DIR, "locales", "en", "storefront.json"), "utf8"),
		),
	);

	it("references every storefront namespace key from the app source", () => {
		const orphans = storefront.filter((key) => !isUsed(key, corpus));
		expect(orphans).toEqual([]);
	});
});
