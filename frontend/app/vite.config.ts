/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	// Pin the dev/preview origin so it matches the collector CORS allow-list and the
	// docs. strictPort fails loudly if 5174 is taken rather than silently landing on
	// another port (which would break the flywheel uplink's CORS).
	server: { port: 5174, strictPort: true },
	test: {
		environment: "jsdom",
		globals: false,
		// Playwright owns tests/e2e + tests/e2e-c1; the demo preflight under
		// scripts/ runs on node:test (`pnpm test:preflight`). Keep Vitest to unit specs.
		exclude: [
			...configDefaults.exclude,
			"tests/e2e/**",
			"tests/e2e-c1/**",
			"scripts/**",
		],
	},
});
