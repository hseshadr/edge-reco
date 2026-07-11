/// <reference types="vitest/config" />
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";

// DEV-ONLY: serve the staged onnxruntime-web runtime under /ort/ as raw files.
// In production /ort/ is plain static output and its loader module dynamic-
// imports cleanly, but the dev server routes .mjs requests through the module
// pipeline and refuses to import files that live in public/ ("can only be
// referenced via HTML tags"). Serving them raw here keeps dev === prod: the
// embedder's `wasmPaths = "/ort/"` works on the dev server too, so even local
// dev never touches the jsDelivr CDN (house standard §8.1b).
function serveOrtRuntimeRawInDev(): Plugin {
	const publicDir = join(dirname(fileURLToPath(import.meta.url)), "public");
	const mime: Record<string, string> = {
		".mjs": "text/javascript",
		".wasm": "application/wasm",
	};
	return {
		name: "edgereco:serve-ort-runtime-raw",
		apply: "serve",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const path = (req.url ?? "").split("?")[0];
				const ext = Object.keys(mime).find((e) => path.endsWith(e));
				if (!path.startsWith("/ort/") || ext === undefined) {
					next();
					return;
				}
				readFile(join(publicDir, path)).then(
					(bytes) => {
						res.setHeader("Content-Type", mime[ext]);
						res.end(bytes);
					},
					() => next(),
				);
			});
		},
	};
}

// The PWA plugin is build-time only; keep it out of Vitest so unit specs are
// byte-for-byte unaffected (registration lives in main.tsx, which tests never load).
const pwa = process.env.VITEST
	? []
	: [
			VitePWA({
				registerType: "autoUpdate",
				includeAssets: ["favicon.svg", "icons.svg"],
				manifest: {
					name: "EdgeReco",
					short_name: "EdgeReco",
					description:
						"Search & recommendations that run on the shopper's device — one small signed file, then zero backend calls.",
					theme_color: "#ff4d2e",
					background_color: "#faf6ef",
					display: "standalone",
					// Relative — the plugin resolves these against VITE_BASE for apex + subpath deploys.
					start_url: ".",
					scope: ".",
					icons: [
						{ src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
						{ src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
						{
							src: "maskable-512x512.png",
							sizes: "512x512",
							type: "image/png",
							purpose: "maskable",
						},
					],
				},
				workbox: {
					// Precache the built shell; NEVER the signed catalog bundle (large + mutable).
					// `.key` is the pinned ed25519 public key (public/public.key): the sync
					// Worker fetches it same-origin on every boot and fails CLOSED if it 404s,
					// so it MUST be precached or an offline reload can never start the engine.
					globPatterns: ["**/*.{js,css,html,svg,png,woff2,wasm,key}"],
					// Never precache the signed catalog bundle (large + mutable) NOR the
					// self-hosted model weights under /models/ (~23 MB, needed only once
					// the shopper launches the demo): transformers.js lazily fetches the
					// weights same-origin and owns their offline copy in its own
					// `transformers-cache` CacheStorage cache (env.useBrowserCache = true
					// in @edgeproc/browser's embedder). Same for the staged /ort/ wasm
					// runtime (~23 MB — offline-covered by the edgereco-wasm runtime
					// route below). Precaching either would force a ~46 MB download on
					// every visitor at SW install.
					globIgnores: ["**/bundle/**", "**/models/**", "**/ort/**"],
					// Same-origin ONNX/zstd WASM can exceed the 2 MB default — allow up to 32 MB.
					maximumFileSizeToCacheInBytes: 32 * 1024 * 1024,
					// SPA: serve index.html for navigations the precache can't match (offline reload).
					navigateFallback: "index.html",
					// The signed bundle origin is cross-origin in the Docker shape; never fall back to it.
					navigateFallbackDenylist: [/\/bundle\//],
					runtimeCaching: [
						{
							urlPattern: ({ url }) =>
								url.origin === "https://fonts.googleapis.com",
							handler: "StaleWhileRevalidate",
							options: { cacheName: "google-fonts-stylesheets" },
						},
						{
							urlPattern: ({ url }) =>
								url.origin === "https://fonts.gstatic.com",
							handler: "CacheFirst",
							options: {
								cacheName: "google-fonts-files",
								expiration: {
									maxEntries: 16,
									maxAgeSeconds: 60 * 60 * 24 * 365,
								},
								cacheableResponse: { statuses: [0, 200] },
							},
						},
						{
							// LEGACY FALLBACK — should never fire: model weights are now
							// SELF-HOSTED under /models/ (house standard §8.1b) and the
							// cold-CDN-blocked e2e proves the runtime never touches the HF
							// host. The route (and its cache NAME) is kept so (a) a client
							// still running an old app build keeps its offline model, and
							// (b) if the local mirror ever regressed to the remote fallback,
							// the model would still be cached rather than re-fetched forever.
							urlPattern: ({ url }) =>
								url.hostname.endsWith("huggingface.co") ||
								url.hostname.endsWith("hf.co"),
							handler: "CacheFirst",
							options: {
								cacheName: "edgereco-model",
								expiration: {
									maxEntries: 64,
									maxAgeSeconds: 60 * 60 * 24 * 365,
								},
								cacheableResponse: { statuses: [0, 200] },
							},
						},
						{
							// The onnxruntime-web wasm runtime. NOW: served same-origin from
							// the staged /ort/ mirror (house standard §8.1b — the loader
							// module's default base is jsDelivr, and the cold-CDN-blocked
							// e2e proves we never touch it); this route makes the pair
							// offline-capable without precaching ~23 MB on every visitor.
							// The jsDelivr half of the pattern is the legacy fallback for
							// clients still running an old app build — same cache NAME as
							// always, so their offline copy stays valid.
							urlPattern: ({ url }) =>
								url.hostname === "cdn.jsdelivr.net" ||
								url.pathname.startsWith("/ort/"),
							handler: "CacheFirst",
							options: {
								cacheName: "edgereco-wasm",
								expiration: {
									maxEntries: 32,
									maxAgeSeconds: 60 * 60 * 24 * 365,
								},
								cacheableResponse: { statuses: [0, 200] },
							},
						},
					],
				},
			}),
		];

// https://vite.dev/config/
export default defineConfig({
	plugins: [react(), serveOrtRuntimeRawInDev(), ...pwa],
	base: process.env.VITE_BASE ?? "/",
	build: {
		// esbuild's default build target ('modules' ≈ es2020) downlevels native
		// private fields (#field) to WeakMap accessors, which transformers.js's
		// minified worker mis-invokes when its CacheStorage path is enabled —
		// the `Ke(...).call is not a function` crash aml-filter debugged. es2022
		// keeps private fields native. Required now that the embedder runs with
		// env.useBrowserCache = true; the cold-CDN-blocked e2e drives the MINIFIED
		// build with the cache on and asserts a clean console, so a downlevel
		// regression re-trips that spec.
		target: "es2022",
	},
	server: { port: 5174, strictPort: true },
	test: {
		environment: "jsdom",
		globals: false,
		setupFiles: ["./src/test-setup.ts"],
		exclude: [
			...configDefaults.exclude,
			"tests/e2e/**",
			"tests/e2e-c1/**",
			"tests/e2e-offline/**",
			"scripts/**",
		],
		coverage: {
			// Off by default; enabled by `test:coverage` + the CI coverage gate.
			// The React view layer — Storefront (orchestration root), Header,
			// ProductGrid, RailStack/RailCard, ProductDetail, SyncBadge, BootScreen,
			// the metrics observer — now carries real @testing-library/react behavior
			// specs (rendered output + interactions, engine boundary mocked), so the
			// floor reflects genuine unit coverage rather than a placeholder.
			//
			// What stays e2e-only (proven by the Playwright e2e/offline suites, NOT
			// gamed with hollow units): the IntersectionObserver dwell path
			// (useDwellViews no-ops under jsdom by design; Storefront onDwell), motion
			// enter/exit animation internals, and the optional fire-and-forget uplink
			// transport internals (uplink.ts — its emit rules are unit-tested, the
			// network/batching/retry path is integration territory).
			provider: "v8",
			reporter: ["text", "json-summary"],
			include: ["src/**/*.{ts,tsx}"],
			exclude: [
				"src/**/*.test.{ts,tsx}",
				"src/test-setup.ts",
				// Type-only modules.
				"src/vite-env.d.ts",
				"src/api/types.ts",
				// SPA + e2e-harness entry points (driven by the Playwright suites).
				"src/main.tsx",
				"src/harness/**",
			],
			// Measured (excl. entry/type): lines 92.4 / statements 91.7 /
			// functions 89.0 / branches 85.1. Floors lock that in ~1pt below so a
			// regression trips the gate; lines + statements hold the 90% standard,
			// functions/branches sit at their honest achieved level (the residual
			// gap is the e2e-only + telemetry-transport paths noted above).
			thresholds: {
				lines: 91,
				statements: 90,
				functions: 88,
				branches: 84,
			},
		},
	},
});
