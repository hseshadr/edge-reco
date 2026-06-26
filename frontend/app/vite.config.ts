/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults } from "vitest/config";

// The PWA plugin is build-time only; keep it out of Vitest so unit specs are
// byte-for-byte unaffected (registration lives in main.tsx, which tests never load).
const pwa = process.env.VITEST
	? []
	: [
			VitePWA({
				registerType: "autoUpdate",
				includeAssets: ["favicon.svg", "icons.svg"],
				manifest: {
					name: "Nimbus — the everything store",
					short_name: "Nimbus",
					description:
						"A storefront that re-ranks toward your taste, live, on your device.",
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
					globIgnores: ["**/bundle/**"],
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
							// The embedding model — the SW owns its offline cache (transformers.js
							// browser cache is disabled in Task 3). resolve/main URLs follow LFS
							// redirects internally, so the huggingface.co request URL is the cache key.
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
							// transformers.js may pull the ONNX runtime WASM from jsDelivr.
							urlPattern: ({ url }) => url.hostname === "cdn.jsdelivr.net",
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
	plugins: [react(), ...pwa],
	base: process.env.VITE_BASE ?? "/",
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
	},
});
