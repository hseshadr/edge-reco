import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const WORKFLOW = resolve(
	import.meta.dirname,
	"../../../.github/workflows/deploy.yml",
);
const FRONTEND_PACKAGE = resolve(import.meta.dirname, "../../package.json");

test("deploy workflow fails visibly instead of reporting a green no-op", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.doesNotMatch(
		workflow,
		/configured=false|skipping deploy|green no-op/u,
	);
	assert.match(workflow, /exit "\$missing"/u);
});

test("deploy workflow verifies the Cloudflare source commit", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.match(workflow, /Verify deployed source identity/u);
	assert.match(workflow, /source\.config\.commit_hash/u);
	assert.match(workflow, /EXPECTED_SHA/u);
});

test("deploy workflow verifies the public build identity endpoint", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.match(workflow, /Verify public build identity/u);
	assert.match(workflow, /https:\/\/edge-reco\.com\/build\.json/u);
	assert.match(workflow, /\.commit \/\/ empty/u);
	assert.match(workflow, /public \/build\.json never reported/u);
});

test("the quality gate builds the same Pages artifact that deploy ships", async () => {
	const packageJson = JSON.parse(await readFile(FRONTEND_PACKAGE, "utf8"));
	assert.match(packageJson.scripts["gate:quality"], /build:pages/u);
	assert.match(packageJson.scripts["gate:quality"], /test:artifacts/u);
});

test("deploy workflow enforces the canonical www redirect", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.match(workflow, /Verify canonical hosts/u);
	assert.match(
		workflow,
		/https:\/\/www\.edge-reco\.com\/faq\?source=deploy-check/u,
	);
	assert.match(workflow, /https:\/\/edge-reco\.com\/faq\?source=deploy-check/u);
});
