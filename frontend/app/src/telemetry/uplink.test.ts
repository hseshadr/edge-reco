import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InteractionEvent } from "../api/types";
import { createUplink, type Uplink, type UplinkConfig } from "./uplink";

// A click event factory — the only event the demo emits today, but the buffer
// is event-shape-agnostic.
function evt(id: string): InteractionEvent {
	return {
		event_type: "click",
		product_id: id,
		timestamp: "2026-01-01T00:00:00Z",
	};
}

/** An in-memory localStorage stand-in (synchronous, like the real one). */
function fakeStorage(): Storage & { map: Map<string, string> } {
	const map = new Map<string, string>();
	return {
		map,
		getItem: (k) => map.get(k) ?? null,
		setItem: (k, v) => void map.set(k, v),
		removeItem: (k) => void map.delete(k),
		clear: () => map.clear(),
		key: (i) => [...map.keys()][i] ?? null,
		get length() {
			return map.size;
		},
	};
}

interface Harness {
	readonly storage: ReturnType<typeof fakeStorage>;
	readonly posts: Array<{
		url: string;
		body: string;
		headers: Record<string, string>;
	}>;
	readonly beacons: Array<{ url: string; body: string }>;
	readonly ticks: Array<() => void>;
	transportOk: boolean;
	config: UplinkConfig;
}

const URL = "http://cloud.test/events";

function harness(overrides: Partial<UplinkConfig> = {}): Harness {
	const storage = fakeStorage();
	const posts: Harness["posts"] = [];
	const beacons: Harness["beacons"] = [];
	const ticks: Array<() => void> = [];
	const h: Harness = {
		storage,
		posts,
		beacons,
		ticks,
		transportOk: true,
		config: {
			url: URL,
			sessionId: "sess-1",
			storage,
			transport: async (url, body, headers) => {
				posts.push({ url, body, headers });
				return h.transportOk;
			},
			beacon: (url, body) => {
				beacons.push({ url, body });
				return true;
			},
			schedule: (cb) => {
				ticks.push(cb);
				return () => {};
			},
			batchSize: 25,
			maxQueue: 500,
			flushIntervalMs: 10_000,
			...overrides,
		},
	};
	return h;
}

beforeEach(() => {
	vi.restoreAllMocks();
});

describe("createUplink", () => {
	it("persists enqueued events so a fresh instance recovers them", () => {
		const h = harness();
		const up = createUplink(h.config);
		up.enqueue(evt("p1"));
		up.enqueue(evt("p2"));

		// A brand-new instance over the SAME storage must see the pending queue.
		const reborn = createUplink(h.config);
		const stored = JSON.parse(h.storage.map.get("nimbus_uplink_queue") ?? "[]");
		expect(stored).toHaveLength(2);
		expect(reborn.pendingCount()).toBe(2);
	});

	it("never throws when storage throws — degrades to in-memory", () => {
		// Safari private mode / quota-exceeded / disabled storage make getItem and
		// setItem throw. The uplink must swallow that (it is off the inference path
		// and must NEVER break the click handler), keeping events in memory.
		const throwingStorage: Pick<Storage, "getItem" | "setItem"> = {
			getItem: () => {
				throw new DOMException("denied", "SecurityError");
			},
			setItem: () => {
				throw new DOMException("quota", "QuotaExceededError");
			},
		};
		const h = harness({ storage: throwingStorage });

		let up!: Uplink;
		// Construction runs #load() (getItem) — must not throw.
		expect(() => {
			up = createUplink(h.config);
		}).not.toThrow();
		// enqueue runs #persist() (setItem) — must not throw, still queues.
		expect(() => up.enqueue(evt("p1"))).not.toThrow();
		expect(up.pendingCount()).toBe(1);
	});

	it("flushes one keepalive POST once the queue reaches BATCH_SIZE", async () => {
		const h = harness({ batchSize: 3 });
		const up = createUplink(h.config);
		up.enqueue(evt("a"));
		up.enqueue(evt("b"));
		expect(h.posts).toHaveLength(0); // below threshold → no network
		up.enqueue(evt("c")); // hits threshold → auto-flush
		await up.flush(); // settle the auto-flush promise

		expect(h.posts).toHaveLength(1);
		const sent = JSON.parse(h.posts[0]?.body ?? "{}");
		expect(sent.session_id).toBe("sess-1");
		expect(sent.events.map((e: InteractionEvent) => e.product_id)).toEqual([
			"a",
			"b",
			"c",
		]);
		expect(h.posts[0]?.headers["X-Session-Id"]).toBe("sess-1");
		expect(up.pendingCount()).toBe(0);
	});

	it("flushes on the periodic tick, and the tick is a no-op when empty", async () => {
		const h = harness({ batchSize: 100 });
		const up = createUplink(h.config);
		// Empty → ticking sends nothing.
		h.ticks[0]?.();
		await up.flush();
		expect(h.posts).toHaveLength(0);

		up.enqueue(evt("x"));
		h.ticks[0]?.(); // periodic flush
		await up.flush();
		expect(h.posts).toHaveLength(1);
	});

	it("drains a large queue in BATCH_SIZE-sized requests", async () => {
		const h = harness({ batchSize: 10 });
		const up = createUplink(h.config);
		for (let i = 0; i < 25; i++) up.enqueue(evt(`p${i}`));
		await up.flush();

		expect(h.posts.map((p) => JSON.parse(p.body).events.length)).toEqual([
			10, 10, 5,
		]);
		expect(up.pendingCount()).toBe(0);
	});

	it("re-queues the in-flight batch to the front on transport failure (no throw)", async () => {
		const h = harness({ batchSize: 5 });
		h.transportOk = false;
		const up = createUplink(h.config);
		for (let i = 0; i < 5; i++) up.enqueue(evt(`p${i}`));

		await expect(up.flush()).resolves.toBeUndefined(); // never throws
		expect(up.pendingCount()).toBe(5); // nothing lost
		expect(
			JSON.parse(h.storage.map.get("nimbus_uplink_queue") ?? "[]"),
		).toHaveLength(5);

		h.transportOk = true;
		await up.flush();
		expect(h.posts).toHaveLength(2); // failed attempt + successful retry
		expect(up.pendingCount()).toBe(0);
	});

	it("bounds the queue to MAX_QUEUE, dropping the oldest", () => {
		const h = harness({ batchSize: 1000, maxQueue: 3 });
		const up = createUplink(h.config);
		for (const id of ["a", "b", "c", "d", "e"]) up.enqueue(evt(id));
		const stored = JSON.parse(h.storage.map.get("nimbus_uplink_queue") ?? "[]");
		expect(stored.map((e: InteractionEvent) => e.product_id)).toEqual([
			"c",
			"d",
			"e",
		]);
	});

	it("is a complete no-op when disabled (no url)", () => {
		const h = harness({ url: undefined });
		const up = createUplink(h.config);
		expect(up.enabled).toBe(false);
		up.enqueue(evt("p1"));
		h.ticks[0]?.();
		expect(h.posts).toHaveLength(0);
		expect(h.ticks).toHaveLength(0); // disabled → never schedules a timer
		expect(h.storage.map.size).toBe(0); // never touches storage
	});

	it("flushes the whole queue via sendBeacon on the unload path", () => {
		const h = harness({ batchSize: 100 });
		const up = createUplink(h.config);
		up.enqueue(evt("a"));
		up.enqueue(evt("b"));
		up.flushBeacon();
		expect(h.beacons).toHaveLength(1);
		const sent = JSON.parse(h.beacons[0]?.body ?? "{}");
		expect(sent.events).toHaveLength(2);
		expect(sent.session_id).toBe("sess-1");
		expect(up.pendingCount()).toBe(0);
	});

	it("does not double-send when flush triggers overlap", async () => {
		const h = harness({ batchSize: 100 });
		const up = createUplink(h.config);
		for (let i = 0; i < 5; i++) up.enqueue(evt(`p${i}`));
		await Promise.all([up.flush(), up.flush()]); // overlapping triggers
		expect(h.posts).toHaveLength(1);
	});

	it("sends each event at most once across an in-flight drain + a concurrent beacon", async () => {
		// Regression: flushBeacon() used to re-beacon the WHOLE #queue without
		// coordinating with an async #drain() that already had a batch on the wire.
		// On unload that double-sent the in-flight events. We hold the transport
		// open to keep a drain in flight, fire flushBeacon during that window, then
		// release — and assert no event is transmitted twice (and none is lost).
		// A holder object (not a bare `let`) so the assignment inside the transport
		// closure does not narrow the captured binding to `never` at the call site
		// under `strict` — property access keeps the declared union type.
		const held: { resolve: ((ok: boolean) => void) | null } = { resolve: null };
		const h = harness({
			batchSize: 3,
			transport: (url, body) => {
				h.posts.push({ url, body, headers: {} });
				return new Promise<boolean>((resolve) => {
					held.resolve = resolve;
				});
			},
		});
		const up = createUplink(h.config);
		for (let i = 0; i < 5; i++) up.enqueue(evt(`p${i}`)); // batchSize=3 → 1 batch claimed, 2 left

		const draining = up.flush(); // claims [p0,p1,p2], awaits the held transport
		expect(h.posts).toHaveLength(1); // first batch is on the wire

		up.flushBeacon(); // unload fires mid-drain

		held.resolve?.(true); // the in-flight POST finally acks
		await draining;
		await up.flush(); // settle any continuation

		// Collect every product_id seen on EITHER path.
		const fromPosts = h.posts.flatMap((p) =>
			JSON.parse(p.body).events.map((e: InteractionEvent) => e.product_id),
		);
		const fromBeacons = h.beacons.flatMap((b) =>
			JSON.parse(b.body).events.map((e: InteractionEvent) => e.product_id),
		);
		const all = [...fromPosts, ...fromBeacons];

		// At most once: no id appears twice across the union of both paths.
		expect(new Set(all).size).toBe(all.length);
		// No loss: every enqueued event is accounted for exactly once.
		expect([...all].sort()).toEqual(["p0", "p1", "p2", "p3", "p4"]);
		// And specifically: the in-flight batch (p0,p1,p2) was NOT re-beaconed.
		for (const id of fromBeacons) {
			expect(["p0", "p1", "p2"]).not.toContain(id);
		}
	});

	it("reports the cumulative confirmed count to onSynced (only on success)", async () => {
		const h = harness({ batchSize: 2 });
		const totals: number[] = [];
		const up = createUplink(h.config);
		up.onSynced((t) => totals.push(t));

		h.transportOk = false;
		for (let i = 0; i < 2; i++) up.enqueue(evt(`p${i}`));
		await up.flush();
		expect(totals).toEqual([]); // failure → no callback

		h.transportOk = true;
		await up.flush();
		expect(totals).toEqual([2]);

		up.enqueue(evt("p2"));
		up.enqueue(evt("p3"));
		await up.flush();
		expect(totals).toEqual([2, 4]); // cumulative
	});
});
