// Preflight for `poe demo`: before opening the SPA, prove that the edge on
// :8081 is serving OUR committed signed bundle — not a foreign one left behind
// by another project's container (the confirmed cause of the cryptic
// "signature verification failed" the user used to hit).
//
// The core is a pure-ish async function with the transport injected, so every
// branch is unit-tested without a live server (see check-edge.test.mjs). The
// CLI wrapper at the bottom reads the committed pointer, fetches the live edge,
// and exits non-zero with an actionable message on any mismatch.

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE = frontend/app/scripts → up 3 to repo root, then the committed bundle.
const COMMITTED_LATEST = join(
	HERE,
	"..",
	"..",
	"..",
	"backend",
	"examples",
	"catalog",
	"latest",
);
const DEFAULT_BASE_URL = "http://localhost:8081";

/** Parse a /latest pointer's manifest_hash, or null if it isn't valid JSON. */
function manifestHashOf(text) {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed.manifest_hash === "string"
			? parsed.manifest_hash
			: null;
	} catch {
		return null;
	}
}

/**
 * Decide whether the edge at `baseUrl` serves our committed bundle.
 * @returns {Promise<{ok: boolean, reason: string}>}
 */
export async function checkEdge({ baseUrl, committedLatestText, fetchImpl }) {
	const expected = manifestHashOf(committedLatestText);
	const url = `${baseUrl}/latest`;

	let response;
	try {
		response = await fetchImpl(url);
	} catch (cause) {
		return {
			ok: false,
			reason: `the edge at ${baseUrl} is not reachable — is it up? (${cause instanceof Error ? cause.message : String(cause)})`,
		};
	}
	if (!response.ok) {
		return {
			ok: false,
			reason: `${url} returned ${response.status} ${response.statusText} — the edge is up but not serving the bundle yet.`,
		};
	}

	const body = await response.text();
	const got = manifestHashOf(body);
	if (got === null) {
		return {
			ok: false,
			reason: `${url} did not return a valid JSON pointer (could not parse the bundle manifest_hash).`,
		};
	}
	if (got !== expected) {
		return {
			ok: false,
			reason:
				`${url} is serving a DIFFERENT bundle than this repo's committed one ` +
				`(got ${got.slice(0, 12)}…, expected ${String(expected).slice(0, 12)}…). ` +
				`Another project is almost certainly occupying :8081 — stop it, then re-run.`,
		};
	}
	return { ok: true, reason: "edge serves the committed bundle" };
}

/** CLI entry: real fetch + committed file, human-readable output, exit code. */
async function main() {
	const baseUrl = process.env.VITE_BUNDLE_BASE_URL ?? DEFAULT_BASE_URL;
	const committedLatestText = await readFile(COMMITTED_LATEST, "utf-8");
	const { ok, reason } = await checkEdge({
		baseUrl,
		committedLatestText,
		fetchImpl: (url) => fetch(url),
	});
	if (ok) {
		process.stdout.write(
			`>> preflight OK — ${baseUrl} serves the signed bundle.\n`,
		);
		return;
	}
	process.stderr.write(
		`\n✗ Demo preflight failed: ${reason}\n\n` +
			`   The Nimbus demo expects its OWN edge on :8081. If another project\n` +
			`   (e.g. a sibling 'frontend' compose project) is using :8081, stop it:\n` +
			`     docker ps --filter publish=8081\n` +
			`   then re-run 'poe demo'.\n\n`,
	);
	process.exit(1);
}

// Run only when invoked directly (not when imported by the test).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	await main();
}
