import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const WORKSPACE = resolve(import.meta.dirname, "../../pnpm-workspace.yaml");

const RELEASE_AGE_KEY = "minimumReleaseAge";
const RELEASE_AGE_EXEMPTION_KEY = "minimumReleaseAgeExclude";
const SAFE_NANOID_RANGE = 'nanoid: ">=3.3.18 <4"';

function liveConfig(yaml) {
	return yaml
		.split("\n")
		.map((line) => line.replace(/(^|\s)#.*$/u, "$1"))
		.join("\n");
}

test("the workspace disables release-age waits without exemptions", async () => {
	const yaml = liveConfig(await readFile(WORKSPACE, "utf8"));
	assert.match(yaml, new RegExp(`^${RELEASE_AGE_KEY}: 0$`, "mu"));
	assert.ok(!yaml.includes(RELEASE_AGE_EXEMPTION_KEY));
});

test("the workspace requires the patched nanoid 3.x line", async () => {
	const yaml = await readFile(WORKSPACE, "utf8");
	assert.ok(liveConfig(yaml).includes(SAFE_NANOID_RANGE));
});
