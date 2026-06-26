import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CATALOG_PRODUCTS, LANDING_METRICS } from "./landing-figures";

// Guard the representative catalog count against the committed bundle source, so
// the landing's "720" can't silently rot if the catalog ever changes. This is the
// single place the number is asserted true — every landing reference derives from it.
describe("landing-figures", () => {
	it("CATALOG_PRODUCTS matches the committed catalog source row count", () => {
		const here = dirname(fileURLToPath(import.meta.url)); // …/frontend/app/src/metrics
		const csv = join(here, "../../../../backend/examples/source/catalog.csv");
		const dataRows = readFileSync(csv, "utf8").trim().split("\n").length - 1; // minus header
		expect(CATALOG_PRODUCTS).toBe(dataRows);
	});

	it("exposes exactly six representative tiles", () => {
		expect(LANDING_METRICS).toHaveLength(6);
	});
});
