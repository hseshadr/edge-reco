import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
	testDir: "tests/e2e-live",
	fullyParallel: false,
	workers: 1,
	retries: 2,
	reporter: [["list"]],
	timeout: 300_000,
	expect: { timeout: 180_000 },
	use: {
		baseURL: process.env.LIVE_BASE_URL ?? "https://edge-reco.com",
		headless: true,
		trace: "retain-on-failure",
	},
	projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
