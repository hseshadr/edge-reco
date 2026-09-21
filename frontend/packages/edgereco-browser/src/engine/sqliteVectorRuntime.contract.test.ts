import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(
	resolve(process.cwd(), "src/engine/vectorIndex.ts"),
	"utf8",
);

describe("browser vector runtime contract", () => {
	it("uses the shared SQLite-vector worker without an in-memory similarity fallback", () => {
		expect(SOURCE).toContain('from "@edgeproc/browser/vector/sqlite"');
		expect(SOURCE).toContain("createSqliteVectorIndex");
		expect(SOURCE).not.toContain("PackedVectorIndex");
		expect(SOURCE).not.toContain("FlatVectorIndex");
		expect(SOURCE).not.toContain("cosineSimilarity");
	});
});
