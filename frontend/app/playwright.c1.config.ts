import { defineConfig, devices } from "@playwright/test";

/**
 * C1 e2e: the in-browser sync engine, proven in a REAL browser with REAL OPFS.
 *
 * Two webServers, started by Playwright:
 *   - the Vite dev server (serves /engine-harness.html + the Worker engine),
 *   - a CORS static server for the live signed bundle + pinned pubkey.
 *
 * `http://localhost` is a secure context, so OPFS (createSyncAccessHandle in the
 * Worker) is available with no COOP/COEP — the spec's static-hostable path.
 */
export default defineConfig({
	testDir: "tests/e2e-c1",
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: 1,
	reporter: [["list"]],
	timeout: 120_000,
	expect: { timeout: 30_000 },
	use: {
		baseURL: "http://localhost:5174",
		headless: true,
		actionTimeout: 20_000,
		navigationTimeout: 30_000,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: [
		{
			command: "npx vite --port 5174 --strictPort",
			url: "http://localhost:5174/engine-harness.html",
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
			env: { VITE_BUNDLE_BASE_URL: "http://localhost:8910/catalog" },
		},
		{
			command: "node tests/e2e-c1/catalog-server.mjs",
			url: "http://localhost:8910/public.key",
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
			env: { CATALOG_PORT: "8910" },
		},
	],
});
