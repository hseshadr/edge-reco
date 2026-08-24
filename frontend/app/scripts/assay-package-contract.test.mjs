import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const PACKAGE_NAME = "@edgeproc/assay";
const VERSION = "0.5.0-dev.2";
const INTEGRITY =
	"sha512-R5uFYeU7l4UkAGRvY7HDcOlLBpSw10WAi2w14WtmkzhpcxYsJO43OsGc/jJ9JN0dxeZjucpFftcXJNRwsSeDJw==";
const PACKAGE_MANIFEST = resolve(
	import.meta.dirname,
	"../../packages/edgeproc-browser/package.json",
);
const INSTALLED_MANIFEST = resolve(
	import.meta.dirname,
	"../../packages/edgeproc-browser/node_modules/@edgeproc/assay/package.json",
);
const LOCKFILE = resolve(import.meta.dirname, "../../pnpm-lock.yaml");

async function readJson(path) {
	return JSON.parse(await readFile(path, "utf8"));
}

test(`${PACKAGE_NAME} is pinned to the verified registry release`, async () => {
	const manifest = await readJson(PACKAGE_MANIFEST);
	assert.equal(manifest.dependencies?.[PACKAGE_NAME], VERSION);
});

test(`the installed ${PACKAGE_NAME} is the verified registry release`, async () => {
	const installed = await readJson(INSTALLED_MANIFEST);
	assert.equal(installed.name, PACKAGE_NAME);
	assert.equal(installed.version, VERSION);
});

test(`${PACKAGE_NAME} lock retains the verified registry SRI`, async () => {
	const lockfile = await readFile(LOCKFILE, "utf8");
	assert.match(lockfile, new RegExp(`'${PACKAGE_NAME}@${VERSION}':`));
	assert.ok(lockfile.includes(`resolution: {integrity: ${INTEGRITY}}`));
});
