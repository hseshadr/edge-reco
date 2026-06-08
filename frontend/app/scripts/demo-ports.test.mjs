// Tests for the demo's random-port helpers (demo-ports.mjs).
//
// The demo used to pin :8081/:8000/:5174, which collided with stale containers
// and sibling projects. These helpers let `demo.mjs` allocate free ports per
// run and rediscover a container's published port. Zero-dep: node's built-in
// test runner, real sockets (no mocks) for the allocator, pure parsing for the
// discovery.

import assert from "node:assert/strict";
import { createServer } from "node:net";
import { test } from "node:test";
import {
	parsePublishedPort,
	pickFreePort,
	pickFreePorts,
} from "./demo-ports.mjs";

const isUsablePort = (p) => Number.isInteger(p) && p > 1023 && p <= 65535;

/** Resolve true if `port` can actually be bound (i.e. it really is free). */
const isBindable = (port) =>
	new Promise((resolve) => {
		const srv = createServer();
		srv.once("error", () => resolve(false));
		srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
	});

test("pickFreePort returns a usable, actually-bindable port", async () => {
	const port = await pickFreePort();
	assert.ok(isUsablePort(port), `expected a usable port, got ${port}`);
	assert.equal(await isBindable(port), true, "picked port should be bindable");
});

test("pickFreePorts(n) returns n distinct usable ports", async () => {
	const ports = await pickFreePorts(4);
	assert.equal(ports.length, 4);
	for (const p of ports) assert.ok(isUsablePort(p), `not usable: ${p}`);
	assert.equal(new Set(ports).size, 4, "ports must be distinct");
});

test("parsePublishedPort parses an IPv4 docker mapping", () => {
	assert.equal(parsePublishedPort("0.0.0.0:54321"), 54321);
});

test("parsePublishedPort handles dual-stack (IPv6 + IPv4) output", () => {
	// `docker compose port` can print one line per protocol family.
	assert.equal(parsePublishedPort("[::]:7000\n0.0.0.0:7000\n"), 7000);
});

test("parsePublishedPort returns null on empty or junk input", () => {
	assert.equal(parsePublishedPort(""), null);
	assert.equal(parsePublishedPort("not a mapping"), null);
	assert.equal(parsePublishedPort("   \n  "), null);
});
