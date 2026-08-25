import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "../../..");
const DAGGER = resolve(ROOT, ".dagger/src/edge_reco/main.py");
const WRANGLER_RELEASE = resolve(import.meta.dirname, "wrangler-release.sh");
const WORKFLOW = resolve(ROOT, ".github/workflows/deploy.yml");
const FRONTEND_PACKAGE = resolve(import.meta.dirname, "../../package.json");

test("Dagger owns exact artifact deployment and every live verification", async () => {
	const dagger = await readFile(DAGGER, "utf8");
	const wrangler = await readFile(WRANGLER_RELEASE, "utf8");
	assert.match(dagger, /with_directory\("\/artifact", artifact\)/u);
	assert.match(dagger, /wrangler-release\.sh/u);
	assert.match(dagger, /playwright\.live\.config\.ts/u);
	assert.match(wrangler, /pages deployment list/u);
	assert.match(wrangler, /release-verify\.test\.mjs/u);
});

test("deploy workflow is only a pinned checkout and Dagger invocation", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.doesNotMatch(workflow, /^\s+run:/mu);
	assert.match(workflow, /persist-credentials: false/u);
	assert.match(workflow, /dagger\/dagger-for-github@[0-9a-f]{40}/u);
	assert.match(workflow, /cloudflare-api-token=env:CLOUDFLARE_API_TOKEN/u);
});

test("Wrangler is an exact repository dependency", async () => {
	const packageJson = JSON.parse(await readFile(FRONTEND_PACKAGE, "utf8"));
	assert.equal(packageJson.devDependencies.wrangler, "4.103.0");
});

test("the quality gate builds and validates the Pages artifact", async () => {
	const packageJson = JSON.parse(await readFile(FRONTEND_PACKAGE, "utf8"));
	assert.match(packageJson.scripts["gate:quality"], /build:pages/u);
	assert.match(packageJson.scripts["gate:quality"], /test:artifacts/u);
});
