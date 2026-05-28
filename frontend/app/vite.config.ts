/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: false,
		// Playwright owns tests/e2e + tests/e2e-c1; keep Vitest to unit specs only.
		exclude: [...configDefaults.exclude, "tests/e2e/**", "tests/e2e-c1/**"],
	},
});
