/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// The package is consumed as TS source by the demo's Vite build; this config
// exists only so the engine's Vitest suite (byte-parity vs the Python producer,
// sync state machine, hybrid search) runs standalone in a jsdom environment —
// the same environment the demo uses.
export default defineConfig({
	test: {
		environment: "jsdom",
		globals: false,
	},
});
