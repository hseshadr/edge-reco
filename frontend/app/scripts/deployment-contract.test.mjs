import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const ROOT = resolve(import.meta.dirname, "../../..");
const DAGGER = resolve(ROOT, ".dagger/src/edge_reco/main.py");
const WRANGLER_RELEASE = resolve(import.meta.dirname, "wrangler-release.sh");
const WORKFLOW = resolve(ROOT, ".github/workflows/deploy.yml");
const FRONTEND_PACKAGE = resolve(import.meta.dirname, "../../package.json");
const DAGGER_SCRIPT_DIRS = [
	resolve(ROOT, ".dagger/src/edge_reco"),
	resolve(ROOT, ".dagger/scripts"),
	resolve(ROOT, "backend/scripts"),
	resolve(ROOT, "frontend/app/scripts"),
];

async function productionScripts(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	return entries
		.filter(
			({ name }) => /\.(?:mjs|py|sh)$/u.test(name) && !name.includes(".test."),
		)
		.map(({ name }) => resolve(directory, name));
}

test("Dagger delegates Pages delivery while retaining local live verification", async () => {
	const dagger = await readFile(DAGGER, "utf8");
	const wrangler = await readFile(WRANGLER_RELEASE, "utf8");
	assert.match(dagger, /dag\.cloudflare_pages\(\)/u);
	assert.match(dagger, /playwright\.live\.config\.ts/u);
	assert.match(dagger, /deployment_url/u);
	assert.doesNotMatch(dagger, /async def _disable_git_deployments/u);
	assert.doesNotMatch(dagger, /async def _deploy_artifact/u);
	assert.doesNotMatch(wrangler, /pages deploy \/artifact/u);
});

test("Dagger installs jq before running deployment contracts", async () => {
	const dagger = await readFile(DAGGER, "utf8");
	const quality = dagger.slice(
		dagger.indexOf("def frontend_quality"),
		dagger.indexOf("def browser_e2e"),
	);
	assert.match(quality, /apt-get[^\n]*install[^\n]*jq/u);
});

test("every retained production script uses an existing or unique scratch path", async () => {
	const paths = (
		await Promise.all(DAGGER_SCRIPT_DIRS.map(productionScripts))
	).flat();
	const scripts = await Promise.all(
		paths.map((path) => readFile(path, "utf8")),
	);
	for (const script of scripts) assert.doesNotMatch(script, /\/work(?:\/|\b)/u);
});

test("deploy workflow is only a pinned checkout and Dagger invocation", async () => {
	const workflow = await readFile(WORKFLOW, "utf8");
	assert.doesNotMatch(workflow, /^\s+run:/mu);
	assert.match(
		workflow,
		/permissions:\n {2}contents: read\n {2}actions: read/u,
	);
	assert.doesNotMatch(
		workflow,
		/\b(?:id-token|packages|deployments): write\b/u,
	);
	assert.match(workflow, /workflow_run\.event == 'push'/u);
	assert.match(workflow, /workflow_run\.conclusion == 'success'/u);
	assert.match(workflow, /workflow_run\.head_branch == 'main'/u);
	assert.match(
		workflow,
		/workflow_run\.head_repository\.full_name == github\.repository/u,
	);
	assert.match(workflow, /persist-credentials: false/u);
	assert.match(workflow, /dagger\/dagger-for-github@[0-9a-f]{40}/u);
	assert.match(workflow, /environment: production/u);
	assert.match(workflow, /cloudflare-api-token=env:CLOUDFLARE_API_TOKEN/u);
	assert.match(workflow, /cloudflare-account-id=env:CLOUDFLARE_ACCOUNT_ID/u);
	assert.match(workflow, /github-token=env:GITHUB_TOKEN/u);
	assert.doesNotMatch(workflow, /CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID): [^$]/u);
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
