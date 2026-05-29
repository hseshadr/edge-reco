// Test-only harness: spawn the engine Worker and expose a tiny imperative API
// on window so Playwright can drive a REAL browser + REAL OPFS run. Not part of
// the Nimbus runtime — it exists solely to prove C1 in a real browser.

import { EngineClient } from "@edgeproc/browser/testing";

interface EngineHarness {
	sync(baseUrl: string, pubkeyUrl: string): Promise<unknown>;
	readFileText(path: string): Promise<string>;
}

declare global {
	interface Window {
		__engineHarness?: EngineHarness;
	}
}

const client = EngineClient.spawn();
const DECODER = new TextDecoder();

window.__engineHarness = {
	async sync(baseUrl, pubkeyUrl) {
		return client.sync(baseUrl, pubkeyUrl);
	},
	async readFileText(path) {
		return DECODER.decode(await client.readFile(path));
	},
};

// Signal readiness to the test harness.
const status = document.getElementById("status");
if (status !== null) {
	status.textContent = "engine-ready";
}
