// Vitest setup: register jest-dom matchers (toBeInTheDocument, etc.) for the
// component specs that render via @testing-library/react under jsdom.
import "@testing-library/jest-dom/vitest";
import { FlatVectorIndex } from "@edgeproc/browser/vector";
import { vi } from "vitest";
// Initialize i18next once (synchronous, bundled catalogs) so components rendered
// WITHOUT an <I18nextProvider> — as the component specs do — still resolve real
// copy via useTranslation() instead of raw keys.
import "./i18n";

// jsdom has no Worker/OPFS. Keep unit tests on the shared vector contract; the
// production-build Playwright suite owns the real SQLite WASM + Worker + OPFS proof.
vi.mock("@edgeproc/browser/vector/sqlite", () => ({
	createSqliteVectorIndex: vi.fn(
		(options: { readonly name: string; readonly dimension: number }) =>
			Promise.resolve(new FlatVectorIndex(options)),
	),
}));
