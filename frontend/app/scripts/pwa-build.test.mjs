import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const APP = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = join(APP, "dist");

test(
	"build:pages emits an installable, bundle-safe service worker",
	() => {
		const r = spawnSync("pnpm", ["run", "build:pages"], {
			cwd: APP,
			stdio: "inherit",
			env: process.env,
		});
		assert.equal(r.status, 0, "build:pages failed");

		assert.ok(existsSync(join(DIST, "sw.js")), "dist/sw.js missing");
		assert.ok(
			existsSync(join(DIST, "manifest.webmanifest")),
			"dist/manifest.webmanifest missing",
		);

		const manifest = JSON.parse(
			readFileSync(join(DIST, "manifest.webmanifest"), "utf8"),
		);
		assert.ok(
			manifest.icons?.some((i) => i.sizes === "192x192"),
			"no 192 icon",
		);
		assert.ok(
			manifest.icons?.some((i) => i.sizes === "512x512"),
			"no 512 icon",
		);
		assert.ok(
			manifest.icons?.some((i) => i.purpose === "maskable"),
			"no maskable icon",
		);

		// The bundle is copied into dist/bundle AFTER the build; the precache must never list it.
		const sw = readFileSync(join(DIST, "sw.js"), "utf8");
		assert.ok(
			!/bundle\//.test(sw),
			"service worker precache must exclude bundle/**",
		);
	},
	{ timeout: 180_000 },
);
