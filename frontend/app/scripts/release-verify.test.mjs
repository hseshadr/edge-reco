import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const SHA = "a".repeat(40);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;

function assertSha(value) {
	if (!SHA_PATTERN.test(value))
		throw new Error("expected a lowercase 40-character Git SHA");
	return value;
}

async function assertArtifactIdentity(directory, expectedSha) {
	const identity = JSON.parse(
		await readFile(join(directory, "build.json"), "utf8"),
	);
	if (identity.commit !== assertSha(expectedSha))
		throw new Error("artifact identity mismatch");
}

function assertDeploymentIdentity(deployments, expectedSha) {
	const exact = deployments.some(
		(value) =>
			value?.deployment_trigger?.metadata?.commit_hash ===
				assertSha(expectedSha) && value?.latest_stage?.status === "success",
	);
	if (!exact)
		throw new Error(`no successful production deployment for ${expectedSha}`);
}

test("artifact identity must equal the exact release SHA", async () => {
	const directory = await mkdtemp(join(tmpdir(), "edge-reco-artifact-"));
	await writeFile(
		join(directory, "build.json"),
		JSON.stringify({ commit: SHA }),
	);
	await assertArtifactIdentity(directory, SHA);
	await assert.rejects(
		() => assertArtifactIdentity(directory, "b".repeat(40)),
		/identity/u,
	);
});

test("deployment identity uses the authoritative trigger metadata", () => {
	const deployments = [
		{
			latest_stage: { status: "success" },
			deployment_trigger: { metadata: { commit_hash: SHA } },
		},
	];
	assert.doesNotThrow(() => assertDeploymentIdentity(deployments, SHA));
	assert.throws(
		() =>
			assertDeploymentIdentity(
				[{ source: { config: { commit_hash: SHA } } }],
				SHA,
			),
		/deployment/u,
	);
});

test("release SHA is canonical lowercase full length", () => {
	assert.equal(assertSha(SHA), SHA);
	for (const invalid of ["abc", "A".repeat(40), "g".repeat(40)]) {
		assert.throws(() => assertSha(invalid), /40-character Git SHA/u);
	}
});

test(
	"mounted artifact matches expected release SHA",
	{ skip: !process.env.ARTIFACT_DIR },
	async () =>
		assertArtifactIdentity(process.env.ARTIFACT_DIR, process.env.EXPECTED_SHA),
);

test("Cloudflare list contains the exact successful deployment source", {
	skip: !process.env.DEPLOYMENTS_PATH,
}, async () => {
	const payload = JSON.parse(
		await readFile(process.env.DEPLOYMENTS_PATH, "utf8"),
	);
	assertDeploymentIdentity(
		Array.isArray(payload) ? payload : payload.result,
		process.env.EXPECTED_SHA,
	);
});
