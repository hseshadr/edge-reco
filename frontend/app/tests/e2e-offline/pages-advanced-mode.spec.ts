import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "@playwright/test";
// @ts-expect-error -- plain-ESM harness, no types (same shape as tests/e2e-c1/catalog-server.mjs).
import { PAGES_RESERVED_PATHS, startPagesServer } from "./pages-server.mjs";

/**
 * THE "works offline" claim, proven on the origin semantics that actually ship.
 *
 * `tests/e2e-offline/offline.spec.ts` proves the airplane-mode journey against
 * `vite preview`. Preview is a plain file server, so it happily serves
 * `dist/_worker.js` — and on Cloudflare Pages advanced mode that same path 404s,
 * because Pages consumes `_worker.js` as the Worker script instead of publishing
 * it. Workbox's install is ATOMIC: one 404 precache entry rejects the install and
 * the service worker never activates. edge-reco.com shipped exactly that state —
 * 24 of 25 precache urls returned 200, the 25th killed all of it — while every
 * preview-driven offline test stayed green.
 *
 * So this lane re-serves the SAME `dist/` through a harness that reproduces the
 * live origin's asset resolution (see pages-server.mjs, measured against
 * https://edge-reco.com) and asserts the thing the claim actually needs: the
 * service worker reaches `activated` and its precache holds the shell.
 */

type Resolved = { url: string; close: () => Promise<void> };

let origin: Resolved;
let precacheUrls: string[];

/** The precache manifest workbox baked into the generated `dist/sw.js`. */
function readPrecacheManifest(swSource: string): string[] {
	const start = swSource.indexOf("precacheAndRoute(");
	if (start === -1)
		throw new Error("dist/sw.js has no precacheAndRoute() call");
	const segment = swSource.slice(start);
	const manifest = segment.slice(0, segment.indexOf("],") + 1);
	const urls = [...manifest.matchAll(/url:\s*"([^"]+)"/g)].map((m) => m[1]);
	if (urls.length === 0)
		throw new Error("dist/sw.js precache manifest is empty");
	return [...new Set(urls)];
}

test.beforeAll(async () => {
	// The app dir, not `rootDir` — Playwright sets rootDir to the testDir.
	const dist = join(dirname(test.info().config.configFile ?? ""), "dist");
	if (!existsSync(join(dist, "sw.js"))) {
		throw new Error(
			`no built service worker at ${dist}/sw.js — run the build first`,
		);
	}
	precacheUrls = readPrecacheManifest(
		readFileSync(join(dist, "sw.js"), "utf8"),
	);
	origin = await startPagesServer({ root: dist });
});

test.afterAll(async () => {
	await origin?.close();
});

test("the harness withholds Cloudflare Pages' reserved paths, as the live origin does", async ({
	request,
}) => {
	// Guard on the guard: if this harness ever degrades into a plain file server
	// it would go green for the same reason `vite preview` did, and prove nothing.
	for (const reserved of PAGES_RESERVED_PATHS as string[]) {
		const response = await request.get(`${origin.url}/${reserved}`, {
			maxRedirects: 0,
		});
		expect(
			response.status(),
			`/${reserved} must not be served as an asset`,
		).toBe(404);
	}
	// And it must still be a real origin for everything else.
	expect((await request.get(`${origin.url}/public.key`)).status()).toBe(200);
	expect((await request.get(`${origin.url}/sw.js`)).status()).toBe(200);
});

test("every precached url resolves on a Cloudflare Pages origin", async ({
	request,
}) => {
	const broken: string[] = [];
	for (const url of precacheUrls) {
		const response = await request.get(`${origin.url}/${url}`);
		if (!response.ok()) broken.push(`${url} -> ${response.status()}`);
	}
	expect(
		broken,
		"a precache entry the origin will not serve aborts the whole install",
	).toEqual([]);
});

test("the service worker installs and activates on a Cloudflare Pages origin", async ({
	page,
}) => {
	const consoleErrors: string[] = [];
	page.on("console", (message) => {
		if (message.type() === "error") consoleErrors.push(message.text());
	});

	await page.goto(`${origin.url}/`);

	const outcome = await page.evaluate(async () => {
		try {
			const registration = await navigator.serviceWorker.register("/sw.js");
			const worker =
				registration.installing ?? registration.waiting ?? registration.active;
			if (!worker) return { state: "no-worker", error: "" };
			if (worker.state === "activated" || worker.state === "activating") {
				return { state: worker.state, error: "" };
			}
			const state = await new Promise<string>((resolve) => {
				worker.addEventListener("statechange", () => {
					if (worker.state === "activated" || worker.state === "redundant") {
						resolve(worker.state);
					}
				});
			});
			return { state, error: "" };
		} catch (cause) {
			return { state: "rejected", error: String(cause) };
		}
	});

	expect(
		outcome,
		"the service worker must survive install on the origin that actually serves it",
	).toEqual({ state: "activated", error: "" });

	// Activated is necessary but not sufficient: the offline claim needs the
	// shell IN the precache, so assert the cache holds every manifest entry.
	const cached = await page.evaluate(async () => {
		const name = (await caches.keys()).find((k) => k.includes("precache"));
		if (!name) return [];
		const requests = await (await caches.open(name)).keys();
		return requests.map((request) => new URL(request.url).pathname);
	});
	const missing = precacheUrls.filter(
		(url) => !cached.includes(`/${url}`.replace("//", "/")),
	);
	expect(missing, "the precache must hold the whole shell").toEqual([]);

	expect(
		consoleErrors,
		"a clean console during service-worker install",
	).toEqual([]);
});
