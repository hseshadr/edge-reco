import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const WORKSPACE = resolve(import.meta.dirname, "../../pnpm-workspace.yaml");

const RELEASE_AGE_KEYS = ["minimumReleaseAge", "minimumReleaseAgeExclude"];
const SAFE_NANOID_RANGE = 'nanoid: ">=3.3.18 <4"';

function liveConfig(yaml) {
	return yaml
		.split("\n")
		.map((line) => line.replace(/(^|\s)#.*$/u, "$1"))
		.join("\n");
}

test("the workspace has no release-age policy or exemption machinery", async () => {
	const yaml = liveConfig(await readFile(WORKSPACE, "utf8"));
	const releaseAgeKey = RELEASE_AGE_KEYS.find((key) => yaml.includes(key));
	assert.equal(releaseAgeKey, undefined);
});

test("the workspace requires the patched nanoid 3.x line", async () => {
	const yaml = await readFile(WORKSPACE, "utf8");
	assert.ok(liveConfig(yaml).includes(SAFE_NANOID_RANGE));
});
