// The durable taste log seam — append/replay/compact/corrupt-tolerance.
//
// These tests drive the seam over an injected in-memory backend (jsdom has no
// OPFS); the REAL OPFS path is proven by the Playwright reload-persistence
// e2e (tests/e2e/persistent-taste.spec.ts). The property under guard: a torn
// or corrupt tail line must NEVER poison boot — bad records are skipped and
// the next write self-heals the file (the aml-filter OPFS-poisoning incident
// is the cautionary tale).

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	__setTasteLogBackendForTests,
	appendTasteEvent,
	clearTasteLog,
	MAX_TASTE_EVENTS,
	readTasteEvents,
	type TasteLogBackend,
} from "./tasteLog";

/** An in-memory stand-in for the OPFS file: one string, atomically replaced. */
function memoryBackend(initial: string | null = null): TasteLogBackend & {
	contents: () => string | null;
} {
	let text: string | null = initial;
	return {
		read: () => Promise.resolve(text),
		write: (next: string) => {
			text = next;
			return Promise.resolve();
		},
		remove: () => {
			text = null;
			return Promise.resolve();
		},
		contents: () => text,
	};
}

/** A backend whose every operation fails (quota / permission / detached). */
function brokenBackend(): TasteLogBackend {
	return {
		read: () => Promise.reject(new Error("storage broken")),
		write: () => Promise.reject(new Error("storage broken")),
		remove: () => Promise.reject(new Error("storage broken")),
	};
}

beforeEach(() => {
	localStorage.clear();
});

afterEach(() => {
	__setTasteLogBackendForTests(undefined);
});

describe("taste log append/replay", () => {
	it("round-trips an appended event as a v1 envelope with the session id", async () => {
		const backend = memoryBackend();
		__setTasteLogBackendForTests(backend);

		await appendTasteEvent("click", "B0TEST01");

		const events = await readTasteEvents();
		expect(events).toHaveLength(1);
		const event = events[0];
		expect(event?.v).toBe(1);
		expect(event?.type).toBe("click");
		expect(event?.productId).toBe("B0TEST01");
		expect(typeof event?.ts).toBe("string");
		// The random per-browser session id — the only identifier, no PII.
		expect(event?.sessionId).not.toBe("");
		expect(event?.sessionId).toBe(localStorage.getItem("nimbus_session_id"));
	});

	it("preserves append order across event types", async () => {
		__setTasteLogBackendForTests(memoryBackend());
		await appendTasteEvent("click", "P1");
		await appendTasteEvent("favorite", "P2");
		await appendTasteEvent("view", "P3");
		const events = await readTasteEvents();
		expect(events.map((e) => `${e.type}:${e.productId}`)).toEqual([
			"click:P1",
			"favorite:P2",
			"view:P3",
		]);
	});

	it(`compacts to the last ${MAX_TASTE_EVENTS} events (rolling window)`, async () => {
		const backend = memoryBackend();
		__setTasteLogBackendForTests(backend);
		for (let i = 0; i < MAX_TASTE_EVENTS + 5; i += 1) {
			await appendTasteEvent("click", `P${i}`);
		}
		const events = await readTasteEvents();
		expect(events).toHaveLength(MAX_TASTE_EVENTS);
		// The OLDEST five fell off; the newest survives.
		expect(events[0]?.productId).toBe("P5");
		expect(events.at(-1)?.productId).toBe(`P${MAX_TASTE_EVENTS + 4}`);
		// The durable file itself is capped too, not just the in-memory view.
		expect(backend.contents()?.trim().split("\n")).toHaveLength(
			MAX_TASTE_EVENTS,
		);
	});
});

describe("taste log corruption tolerance (torn writes must not poison boot)", () => {
	const good = (id: string): string =>
		JSON.stringify({
			v: 1,
			ts: "2026-07-21T00:00:00.000Z",
			type: "click",
			productId: id,
			sessionId: "s-1",
		});

	it("skips a torn (half-written) tail line and keeps the valid prefix", async () => {
		__setTasteLogBackendForTests(
			memoryBackend(`${good("P1")}\n${good("P2")}\n{"v":1,"ts":"2026-0`),
		);
		const events = await readTasteEvents();
		expect(events.map((e) => e.productId)).toEqual(["P1", "P2"]);
	});

	it("skips structurally invalid envelopes (wrong version, unknown type, missing id)", async () => {
		const wrongVersion = JSON.stringify({
			v: 2,
			ts: "t",
			type: "click",
			productId: "PX",
			sessionId: "s",
		});
		const unknownType = JSON.stringify({
			v: 1,
			ts: "t",
			type: "purchase",
			productId: "PY",
			sessionId: "s",
		});
		const missingId = JSON.stringify({
			v: 1,
			ts: "t",
			type: "click",
			sessionId: "s",
		});
		__setTasteLogBackendForTests(
			memoryBackend(
				[good("P1"), wrongVersion, unknownType, missingId, good("P2")].join(
					"\n",
				),
			),
		);
		const events = await readTasteEvents();
		expect(events.map((e) => e.productId)).toEqual(["P1", "P2"]);
	});

	it("self-heals: the next append rewrites the file with only valid records", async () => {
		const backend = memoryBackend(`${good("P1")}\nnot json at all`);
		__setTasteLogBackendForTests(backend);
		await appendTasteEvent("cart", "P2");
		const stored = backend.contents()?.trim().split("\n") ?? [];
		expect(stored).toHaveLength(2);
		expect(stored.every((line) => JSON.parse(line).v === 1)).toBe(true);
	});

	it("a completely unreadable log degrades to empty (session-only), never throws", async () => {
		__setTasteLogBackendForTests(brokenBackend());
		await expect(readTasteEvents()).resolves.toEqual([]);
		await expect(appendTasteEvent("click", "P1")).resolves.toBeUndefined();
		await expect(clearTasteLog()).resolves.toBeUndefined();
	});
});

describe("taste log reset + no-storage degrade", () => {
	it("clearTasteLog empties the log durably", async () => {
		const backend = memoryBackend();
		__setTasteLogBackendForTests(backend);
		await appendTasteEvent("click", "P1");
		await clearTasteLog();
		expect(await readTasteEvents()).toEqual([]);
		expect(backend.contents()).toBeNull();
		// And the wipe survives a fresh read (nothing cached back).
		await appendTasteEvent("click", "P2");
		expect((await readTasteEvents()).map((e) => e.productId)).toEqual(["P2"]);
	});

	it("no storage backend at all (jsdom default): every op no-ops safely", async () => {
		__setTasteLogBackendForTests(null);
		await expect(appendTasteEvent("click", "P1")).resolves.toBeUndefined();
		await expect(readTasteEvents()).resolves.toEqual([]);
		await expect(clearTasteLog()).resolves.toBeUndefined();
	});
});
