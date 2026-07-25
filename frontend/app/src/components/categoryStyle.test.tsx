// The catalog uses compound Amazon category names ("Clothing, Shoes & Jewelry",
// "Cell Phones & Accessories", …). The tile mapping must resolve every REAL
// category to its own distinct style — the default "Catalog" tile is the
// exception for unknown categories, not the norm. To keep this honest against
// the actual taxonomy (not a hand-typed shape of it), the categories are read
// from the bundled signed catalog fixture that also drives the engine tests.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE, styleForCategory, toneClassFor } from "./categoryStyle";

const BUNDLE_CATALOG_DIR = join(
	__dirname,
	"../../../packages/edgeproc-browser/src/engine/__fixtures__/bundle/catalog",
);

interface ManifestChunk {
	readonly hash: string;
}
interface ManifestFile {
	readonly path: string;
	readonly chunks: ReadonlyArray<ManifestChunk>;
}

/** Reassemble a bundle file from its zstd chunks, exactly as the sync client does. */
function readBundleFile(path: string): Buffer {
	const manifestDir = join(BUNDLE_CATALOG_DIR, "manifest");
	const [manifestName] = readdirSync(manifestDir);
	if (manifestName === undefined) throw new Error("bundle manifest missing");
	const manifest = JSON.parse(
		readFileSync(join(manifestDir, manifestName), "utf8"),
	) as { files: ReadonlyArray<ManifestFile> };
	const file = manifest.files.find((f) => f.path === path);
	if (file === undefined) throw new Error(`bundle file missing: ${path}`);
	return Buffer.concat(
		file.chunks.map((chunk) =>
			zstdDecompressSync(
				readFileSync(join(BUNDLE_CATALOG_DIR, "chunk", chunk.hash)),
			),
		),
	);
}

interface CatalogRow {
	readonly id: string;
	readonly category: string;
}

function loadCatalog(): CatalogRow[] {
	return readBundleFile("products.jsonl")
		.toString("utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as CatalogRow);
}

const catalog = loadCatalog();
const realCategories = [...new Set(catalog.map((row) => row.category))];

describe("styleForCategory against the real bundled taxonomy", () => {
	it("resolves every real catalog category to a non-default style", () => {
		// Sanity: the fixture read itself must not silently degrade.
		expect(realCategories.length).toBeGreaterThanOrEqual(10);
		for (const category of realCategories) {
			const style = styleForCategory(category);
			expect(style.className, `"${category}" fell through to default`).not.toBe(
				DEFAULT_STYLE.className,
			);
		}
	});

	it("gives each real category its own distinct tile style", () => {
		const classNames = realCategories.map((c) => styleForCategory(c).className);
		expect(new Set(classNames).size).toBe(realCategories.length);
	});

	it("is deterministic and normalization-insensitive", () => {
		for (const category of realCategories) {
			const style = styleForCategory(category);
			expect(styleForCategory(category)).toEqual(style);
			expect(styleForCategory(`  ${category.toUpperCase()}  `)).toEqual(style);
		}
	});

	it("keeps the default tile for a genuinely unknown category", () => {
		expect(styleForCategory("Quantum Chronosynclastics")).toEqual(
			DEFAULT_STYLE,
		);
		expect(styleForCategory("")).toEqual(DEFAULT_STYLE);
	});
});

describe("toneClassFor per-product variation", () => {
	it("is deterministic per product id", () => {
		for (const row of catalog.slice(0, 50)) {
			expect(toneClassFor(row.id)).toBe(toneClassFor(row.id));
		}
	});

	it("spreads real product ids across all tone variants so one category is not one flat color", () => {
		const tones = new Set(catalog.map((row) => toneClassFor(row.id)));
		expect(tones.size).toBe(3);
	});
});
