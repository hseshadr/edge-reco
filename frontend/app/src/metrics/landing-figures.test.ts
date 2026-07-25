import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	CATALOG_PRODUCTS,
	LANDING_METRICS,
	REFERENCE_MEASUREMENT,
	REFERENCE_TOLERANCE,
} from "./landing-figures";

const here = dirname(fileURLToPath(import.meta.url)); // …/frontend/app/src/metrics
const repoRoot = join(here, "../../../..");
const readme = () => readFileSync(join(repoRoot, "README.md"), "utf8");

/** The tile's number as a plain figure: "~1.2" -> 1.2, "~36" -> 36. */
const tileValue = (id: string): number => {
	const tile = LANDING_METRICS.find((m) => m.id === id);
	if (!tile) throw new Error(`no landing tile with id "${id}"`);
	return Number.parseFloat(tile.num.replace("~", ""));
};

/** Within a factor of REFERENCE_TOLERANCE in EITHER direction. */
const withinBand = (claimed: number, measured: number): boolean =>
	claimed <= measured * REFERENCE_TOLERANCE &&
	claimed >= measured / REFERENCE_TOLERANCE;

// Guard the representative catalog count against the committed bundle source, so
// the landing's "720" can't silently rot if the catalog ever changes. This is the
// single place the number is asserted true — every landing reference derives from it.
describe("landing-figures", () => {
	it("CATALOG_PRODUCTS matches the committed catalog source row count", () => {
		const csv = join(repoRoot, "backend/examples/source/catalog.csv");
		const dataRows = readFileSync(csv, "utf8").trim().split("\n").length - 1; // minus header
		expect(CATALOG_PRODUCTS).toBe(dataRows);
	});

	it("exposes exactly six representative tiles", () => {
		expect(LANDING_METRICS).toHaveLength(6);
	});
});

// This repo once published THREE different values for the same three metrics —
// README.md, these tiles, and the live app all disagreed, and nothing failed.
// These tests make that specific silent drift impossible: the figures live here
// and only here, and they must stay in the neighbourhood of a real measurement.
describe("performance figures live in exactly one place", () => {
	it("README.md states no millisecond timing", () => {
		// The only `<n>ms` strings the README ever held were the perf claims.
		expect(readme().match(/\d+(\.\d+)?\s?ms\b/g)).toBeNull();
	});

	it("README.md states no JS heap size", () => {
		// Scoped to heap so legitimate artifact sizes ("~23 MB" model) still pass.
		const heapClaim =
			/heap[^.\n]*?\d+(\.\d+)?\s?(MB|MiB)|\d+(\.\d+)?\s?(MB|MiB)[^.\n]*?heap/i;
		expect(readme()).not.toMatch(heapClaim);
	});

	it("README.md states no cold-boot time", () => {
		const bootClaim =
			/cold (boot|start)[^.\n]*?\d+(\.\d+)?\s?s\b|\d+(\.\d+)?\s?s\b[^.\n]*?cold (boot|start)/i;
		expect(readme()).not.toMatch(bootClaim);
	});

	it("README.md pins no deployed commit SHA", () => {
		// It once claimed bcd1713… was deployed while a89e0ba… actually was. A SHA
		// goes stale on the very next deploy; build.json is the live answer.
		expect(readme().match(/\b[0-9a-f]{40}\b/g)).toBeNull();
	});

	it("the landing tiles stay within an order of magnitude of a real run", () => {
		expect(
			withinBand(tileValue("latency"), REFERENCE_MEASUREMENT.searchP50Ms),
		).toBe(true);
		expect(
			withinBand(
				tileValue("coldStart") * 1000,
				REFERENCE_MEASUREMENT.coldStartMs,
			),
		).toBe(true);
		expect(withinBand(tileValue("heap"), REFERENCE_MEASUREMENT.heapMb)).toBe(
			true,
		);
	});
});
