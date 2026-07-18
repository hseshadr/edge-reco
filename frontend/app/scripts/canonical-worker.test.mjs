import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import vm from "node:vm";

const WORKER = new URL("../public/_worker.js", import.meta.url);

async function loadWorker() {
	const source = await readFile(WORKER, "utf8");
	const context = {
		URL,
		Request,
		Response,
		module: { exports: undefined },
	};
	vm.runInNewContext(
		source.replace("export default", "module.exports ="),
		context,
	);
	return context.module.exports;
}

test("Pages worker redirects www to apex while preserving path and query", async () => {
	const worker = await loadWorker();
	const response = await worker.fetch(
		new Request("https://www.edge-reco.com/faq?source=deploy-check"),
		{ ASSETS: { fetch: async () => new Response("asset") } },
	);

	assert.equal(response.status, 308);
	assert.equal(
		response.headers.get("location"),
		"https://edge-reco.com/faq?source=deploy-check",
	);
});

test("Pages worker normalizes host case and a trailing DNS dot before redirecting", async () => {
	const worker = await loadWorker();
	const response = await worker.fetch(
		new Request("https://WWW.EDGE-RECO.COM./faq?source=deploy-check"),
		{ ASSETS: { fetch: async () => new Response("asset") } },
	);

	assert.equal(response.status, 308);
	assert.equal(
		response.headers.get("location"),
		"https://edge-reco.com/faq?source=deploy-check",
	);
});

test("Pages worker serves apex requests through the static asset binding", async () => {
	const worker = await loadWorker();
	const asset = new Response("asset");
	const response = await worker.fetch(
		new Request("https://edge-reco.com/faq"),
		{ ASSETS: { fetch: async () => asset } },
	);

	assert.equal(response, asset);
});
