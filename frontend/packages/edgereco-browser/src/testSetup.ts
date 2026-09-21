import { FlatVectorIndex } from "@edgeproc/browser/vector";
import { vi } from "vitest";

// jsdom has no Worker/OPFS. Product tests keep the exact shared VectorIndex
// contract while the real SQLite WASM + Worker + OPFS path is exercised by the
// production-build Playwright lane.
vi.mock("@edgeproc/browser/vector/sqlite", () => ({
	createSqliteVectorIndex: vi.fn(
		(options: { readonly name: string; readonly dimension: number }) =>
			Promise.resolve(new FlatVectorIndex(options)),
	),
}));
