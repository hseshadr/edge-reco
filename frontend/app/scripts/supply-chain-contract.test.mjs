import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const WORKSPACE = resolve(import.meta.dirname, "../../pnpm-workspace.yaml");

// pnpm's supply-chain age check (`minimumReleaseAge`) refuses to install a package
// published within the configured window — the window that catches a freshly
// compromised release before anyone depends on it. On pnpm v11 that check runs in
// NON-STRICT mode: a plain `pnpm install` that trips it does not fail. It SILENTLY
// rewrites pnpm-workspace.yaml, appending the tripped package to a
// `minimumReleaseAgeExclude:` list, with no prompt and no output. Once committed,
// that exemption disables the age check for that package for every future install,
// CI included. It has slipped into commits twice in this portfolio and been
// reverted both times, so treat any committed exemption as a gate failure.
const FORBIDDEN_KEY = "minimumReleaseAgeExclude";

const REMEDIATION = `
${FORBIDDEN_KEY} is committed in frontend/pnpm-workspace.yaml. Remove it.

WHY THIS FAILS: pnpm auto-injects this key when a plain (non-frozen) \`pnpm install\`
hits a package younger than \`minimumReleaseAge\`. pnpm v11 does it silently, without
asking. A committed exemption permanently disables the supply-chain age check for
that package — in CI too. The age check firing is the control WORKING; the fix is to
wait the release window out, never to exempt the package.

HOW TO REMOVE IT:
  1. Delete the '${FORBIDDEN_KEY}:' key and every list item under it
     from frontend/pnpm-workspace.yaml.
  2. Run \`pnpm install --frozen-lockfile\` — it must report "Already up to date".
  3. Re-run \`pnpm gate\`.

Use \`pnpm install --frozen-lockfile\` (what CI runs) to avoid re-injecting it. If a
dependency genuinely cannot wait out the window, escalate to a human — do not commit
the exemption.
`;

/**
 * Strip YAML comments so the explanatory comment above may name the forbidden key
 * without tripping the guard. A comment cannot change pnpm's behaviour; everything
 * that survives this strip is live configuration.
 */
function liveConfig(yaml) {
	return yaml
		.split("\n")
		.map((line) => line.replace(/(^|\s)#.*$/u, "$1"))
		.join("\n");
}

function hasCommittedExemption(yaml) {
	return liveConfig(yaml).includes(FORBIDDEN_KEY);
}

test("no pnpm supply-chain exemption is committed to the workspace", async () => {
	const yaml = await readFile(WORKSPACE, "utf8");
	assert.ok(!hasCommittedExemption(yaml), REMEDIATION);
});

test("the guard detects an exemption block pnpm injected", () => {
	assert.ok(
		hasCommittedExemption(
			[
				"packages:",
				"  - app",
				`${FORBIDDEN_KEY}:`,
				"  - '@edgeproc/avow@0.1.0'",
			].join("\n"),
		),
	);
});

test("the guard detects an exemption written as an inline flow mapping", () => {
	assert.ok(
		hasCommittedExemption(`${FORBIDDEN_KEY}: ['@edgeproc/avow@0.1.0']`),
	);
});

test("the guard ignores the key when it appears only in a comment", () => {
	assert.ok(
		!hasCommittedExemption(
			["packages:", "  - app", `# never commit ${FORBIDDEN_KEY} here`].join(
				"\n",
			),
		),
	);
});
