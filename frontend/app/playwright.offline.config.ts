import { defineConfig, devices } from "@playwright/test";

/**
 * Offline PROOF — runs against a PREVIEW of the production build so the REAL
 * generated service worker (precache + runtime caches) is active. Unlike the
 * main e2e suite, the embedder is NOT stubbed: the real ~25 MB model loads once
 * online, the SW caches it, and the offline reload must serve it from cache.
 */
const CATALOG_PORT = 8921; // distinct from the main e2e's 8920
const PREVIEW_PORT = 5175; // distinct from the dev server's 5174

export default defineConfig({
	testDir: "tests/e2e-offline",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"]],
	timeout: 300_000, // a real model download happens once, online
	expect: { timeout: 60_000 },
	use: {
		baseURL: `http://localhost:${PREVIEW_PORT}`,
		headless: true,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
	webServer: [
		{
			command: `npx vite preview --port ${PREVIEW_PORT} --strictPort`,
			url: `http://localhost:${PREVIEW_PORT}/public.key`,
			reuseExistingServer: !process.env.CI,
			timeout: 60_000,
		},
		{
			command: "node tests/e2e-c1/catalog-server.mjs",
			url: `http://localhost:${CATALOG_PORT}/public.key`,
			reuseExistingServer: !process.env.CI,
			timeout: 30_000,
			env: { CATALOG_PORT: String(CATALOG_PORT) },
		},
	],
});
