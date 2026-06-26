// Build the static, backend-free demo for host-based deployment. Two steps:
//
//   1. the normal production build (`pnpm run build` = tsc -b && vite build)
//      with the static env: VITE_BASE=/ (the canonical host is the apex domain
//      edge-reco.com on Cloudflare Pages, served at the root) and
//      VITE_BUNDLE_BASE_URL=bundle (app-relative; the SPA absolutizes it at
//      runtime — src/api/bundleUrl.ts — so the same dist works on any host
//      that serves it under VITE_BASE);
//   2. copy the committed signed catalog bundle (backend/examples/catalog)
//      same-origin into dist/bundle — no CORS, no second origin to run.
//
// VITE_EVENTS_URL is deliberately left alone (unset → uplink disabled → the
// hosted demo makes zero backend calls). Defaults are env-overridable: a fork
// hosting under a GitHub Pages project subpath sets VITE_BASE=/<repo>/.
//
// Run: `pnpm -F frontend run build:pages` (locally, or as the Cloudflare Pages
// build command — see docs/DEPLOY.md).

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** The committed signed bundle this repo ships (latest + manifest/* + chunk/*). */
export const CATALOG_DIR = resolve(
	APP_DIR,
	"..",
	"..",
	"backend",
	"examples",
	"catalog",
);

const DIST_DIR = join(APP_DIR, "dist");
const DIST_BUNDLE_DIR = join(DIST_DIR, "bundle");

/** Static build env: fill the two host knobs unless the caller already set them. */
export function pagesEnv(env) {
	return {
		...env,
		// Root base: the canonical host (edge-reco.com on Cloudflare Pages) serves
		// at "/". Forks on a GitHub Pages project subpath override VITE_BASE=/<repo>/.
		VITE_BASE: env.VITE_BASE ?? "/",
		VITE_BUNDLE_BASE_URL: env.VITE_BUNDLE_BASE_URL ?? "bundle",
	};
}

function die(message) {
	process.stderr.write(`!! ${message}\n`);
	process.exit(1);
}

function main() {
	if (!existsSync(join(CATALOG_DIR, "latest"))) {
		die(`no signed bundle at ${CATALOG_DIR} — expected the committed catalog.`);
	}

	const env = pagesEnv(process.env);
	process.stdout.write(
		`>> Pages build: VITE_BASE=${env.VITE_BASE} VITE_BUNDLE_BASE_URL=${env.VITE_BUNDLE_BASE_URL}\n`,
	);
	const build = spawnSync("pnpm", ["run", "build"], {
		cwd: APP_DIR,
		env,
		stdio: "inherit",
	});
	if (build.status !== 0) {
		die("vite build failed.");
	}

	// Re-copy from scratch so a stale dist/bundle never ships old chunks.
	rmSync(DIST_BUNDLE_DIR, { recursive: true, force: true });
	cpSync(CATALOG_DIR, DIST_BUNDLE_DIR, { recursive: true });
	if (!existsSync(join(DIST_BUNDLE_DIR, "latest"))) {
		die("bundle copy failed — dist/bundle/latest missing.");
	}
	process.stdout.write(
		`>> Pages dist ready: ${DIST_DIR} (signed bundle copied same-origin to dist/bundle)\n`,
	);
}

// Import-safe for tests: only run when executed directly (node scripts/build-pages.mjs).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main();
}
