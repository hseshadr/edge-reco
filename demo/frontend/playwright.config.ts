import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e config for the Nimbus storefront.
 *
 * The backend (FastAPI over edge-reco) and the Vite dev server are started
 * out-of-band — the backend is not an npm script (it needs
 * `uv run python -m demo.backend.serve`), so we deliberately do NOT use
 * Playwright's `webServer`. Run both servers first, then `npx playwright test`.
 */
export default defineConfig({
	testDir: "tests/e2e",
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: [["list"]],
	timeout: 60_000,
	expect: { timeout: 15_000 },
	use: {
		baseURL: "http://localhost:5173",
		headless: true,
		actionTimeout: 15_000,
		navigationTimeout: 30_000,
		trace: "retain-on-failure",
	},
	projects: [
		{
			name: "chromium",
			use: { ...devices["Desktop Chrome"] },
		},
	],
});
