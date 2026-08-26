import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

const ROOT = resolve(import.meta.dirname, "../../..");
const DAGGER = resolve(ROOT, ".dagger/src/edge_reco/main.py");
const CLOUDFLARE_RELEASE = resolve(ROOT, ".dagger/scripts/cloudflare-pages.sh");
const WRANGLER_RELEASE = resolve(import.meta.dirname, "wrangler-release.sh");
const WORKFLOW = resolve(ROOT, ".github/workflows/deploy.yml");
const FRONTEND_PACKAGE = resolve(import.meta.dirname, "../../package.json");
const SHA = "a".repeat(40);
const execFile = promisify(execFileCallback);
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

async function fakeReleaseTools(successOn, responseSha = SHA) {
	const directory = await mkdtemp(join(tmpdir(), "edge-reco-release-"));
	const attempts = join(directory, "attempts");
	const sleeps = join(directory, "sleeps");
	const curl = `#!/bin/sh
cat >/dev/null
output=; while test "$#" -gt 0; do test "$1" != -o || { output=$2; shift; }; shift; done
count=0; test ! -f "$ATTEMPTS" || count=$(cat "$ATTEMPTS")
count=$((count + 1)); printf '%s' "$count" >"$ATTEMPTS"
status=active; test "$count" -lt "$SUCCESS_ON" || status=success
printf '{"success":true,"result":[{"environment":"production","latest_stage":{"name":"deploy","status":"%s"},"deployment_trigger":{"metadata":{"commit_hash":"%s"}}}]}' "$status" "$RESPONSE_SHA" >"$output"
`;
	await writeFile(join(directory, "curl"), curl, { mode: 0o755 });
	await writeFile(
		join(directory, "sleep"),
		'#!/bin/sh\nprintf \'%s\\n\' "$1" >>"$SLEEPS"\n',
		{ mode: 0o755 },
	);
	return { attempts, directory, responseSha, sleeps, successOn };
}

async function runRelease(tools, timeout = "60") {
	const env = {
		...process.env,
		ATTEMPTS: tools.attempts,
		DEPLOY_VERIFY_TIMEOUT_SECONDS: timeout,
		CLOUDFLARE_ACCOUNT_ID: "account",
		CLOUDFLARE_API_TOKEN: "token",
		EXPECTED_SHA: SHA,
		PATH: `${tools.directory}:${process.env.PATH}`,
		RESPONSE_SHA: tools.responseSha,
		SLEEPS: tools.sleeps,
		SUCCESS_ON: tools.successOn,
	};
	return execFile("sh", [CLOUDFLARE_RELEASE, "verify"], { env });
}

async function mockPagesApi() {
	const requests = [];
	const server = createServer((request, response) => {
		requests.push(request.url);
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				success: true,
				result: [
					{
						environment: "production",
						latest_stage: { name: "deploy", status: "success" },
						deployment_trigger: { metadata: { commit_hash: SHA } },
					},
				],
			}),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert(address && typeof address !== "string");
	return { base: `http://127.0.0.1:${address.port}`, requests, server };
}

async function runAgainstMock(base) {
	const env = {
		...process.env,
		CLOUDFLARE_ACCOUNT_ID: "account",
		CLOUDFLARE_API_BASE: base,
		CLOUDFLARE_API_TOKEN: "token",
		DEPLOY_VERIFY_TIMEOUT_SECONDS: "0",
		EXPECTED_SHA: SHA,
	};
	return execFile("sh", [CLOUDFLARE_RELEASE, "verify"], { env });
}

test("Dagger owns exact artifact deployment and every live verification", async () => {
	const dagger = await readFile(DAGGER, "utf8");
	const cloudflare = await readFile(CLOUDFLARE_RELEASE, "utf8");
	const wrangler = await readFile(WRANGLER_RELEASE, "utf8");
	assert.match(dagger, /with_directory\("\/artifact", artifact\)/u);
	assert.match(dagger, /wrangler-release\.sh/u);
	assert.match(dagger, /cloudflare-pages\.sh/u);
	assert.match(dagger, /playwright\.live\.config\.ts/u);
	assert.doesNotMatch(wrangler, /pages deployment list/u);
	assert.match(cloudflare, /curl -fsS --config -/u);
	assert.doesNotMatch(cloudflare, /curl[^\n]*CLOUDFLARE_API_TOKEN/u);
});

test("Dagger installs jq before running deployment contracts", async () => {
	const dagger = await readFile(DAGGER, "utf8");
	const quality = dagger.slice(
		dagger.indexOf("def frontend_quality"),
		dagger.indexOf("def browser_e2e"),
	);
	assert.match(quality, /apt-get[^\n]*install[^\n]*jq/u);
});

test("every Dagger production script uses an existing or unique scratch path", async () => {
	const paths = (
		await Promise.all(DAGGER_SCRIPT_DIRS.map(productionScripts))
	).flat();
	const scripts = await Promise.all(
		paths.map((path) => readFile(path, "utf8")),
	);
	for (const script of scripts) assert.doesNotMatch(script, /\/work(?:\/|\b)/u);
	assert.match(await readFile(CLOUDFLARE_RELEASE, "utf8"), /mktemp/u);
});

test("deployment verification polls with bounded backoff until exact success", async () => {
	const converging = await fakeReleaseTools("4");
	await runRelease(converging);
	assert.equal(await readFile(converging.attempts, "utf8"), "4");
	assert.equal(await readFile(converging.sleeps, "utf8"), "1\n2\n4\n");
	const stalled = await fakeReleaseTools("99");
	await assert.rejects(() => runRelease(stalled, "0"));
	assert.equal(await readFile(stalled.attempts, "utf8"), "1");
	const wrongSha = await fakeReleaseTools("1", "b".repeat(40));
	await assert.rejects(() => runRelease(wrongSha, "0"));
});

test("deployment verification requests the raw Pages deployments API", async () => {
	const mock = await mockPagesApi();
	try {
		await runAgainstMock(mock.base);
	} finally {
		await new Promise((resolve) => mock.server.close(resolve));
	}
	assert.deepEqual(mock.requests, [
		"/accounts/account/pages/projects/edge-reco/deployments?env=production&per_page=100",
	]);
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
