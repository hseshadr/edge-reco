// The PerformanceObserver wiring is hard to drive in jsdom, so the per-entry
// counting is factored into the pure `countBackendCalls` helper and tested here
// directly: edge/other count, image/uplink don't, pre-readyAt entries are
// ignored, and unparseable URLs fall through to "other" (i.e. counted).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	countBackendCalls,
	type ObserveOptions,
	startMetricsObservers,
	toResourceEntries,
} from "./observe";
import { record } from "./store";

// The live wiring (startMetricsObservers) records into the metrics store; mock
// it so we can assert on what the observer + memory poll push without touching
// the real singleton.
vi.mock("./store", () => ({ record: vi.fn() }));

const READY_AT = 100;
const OPTS: ObserveOptions = {
	readyAt: READY_AT,
	edgeOrigin: "https://cdn.example.com",
	eventsUrl: "https://events.example.com/events",
	appOrigin: "http://localhost:4173",
};

function entry(name: string, startTime: number) {
	return { name, startTime };
}

describe("countBackendCalls", () => {
	it("counts edge-origin requests as backend calls", () => {
		const entries = [entry("https://cdn.example.com/latest", 150)];
		expect(countBackendCalls(entries, OPTS)).toBe(1);
	});

	it("counts unknown ('other') origins as backend calls", () => {
		const entries = [entry("https://api.somewhere.com/infer", 150)];
		expect(countBackendCalls(entries, OPTS)).toBe(1);
	});

	it("does NOT count product images", () => {
		const entries = [entry("https://m.media-amazon.com/images/I/abc.jpg", 150)];
		expect(countBackendCalls(entries, OPTS)).toBe(0);
	});

	it("does NOT count same-origin /images/ local product assets", () => {
		// Baked-in bundle images served same-origin (/images/<id>.svg) are static
		// assets, not backend calls — the honest "0 after sync" headline must hold.
		const entries = [entry("http://localhost:4173/images/P1.svg", 150)];
		expect(countBackendCalls(entries, OPTS)).toBe(0);
	});

	it("does NOT count the optional uplink beacon", () => {
		const entries = [entry("https://events.example.com/events", 150)];
		expect(countBackendCalls(entries, OPTS)).toBe(0);
	});

	it("ignores entries that started before readyAt", () => {
		const entries = [
			entry("https://cdn.example.com/sync-during-boot", 50),
			entry("https://api.elsewhere.com/boot", 99),
		];
		expect(countBackendCalls(entries, OPTS)).toBe(0);
	});

	it("counts an entry exactly at readyAt (inclusive boundary)", () => {
		const entries = [entry("https://cdn.example.com/latest", READY_AT)];
		expect(countBackendCalls(entries, OPTS)).toBe(1);
	});

	it("sums a mixed batch: only post-ready edge/other count", () => {
		const entries = [
			entry("https://cdn.example.com/manifest", 200), // edge  -> count
			entry("https://m.media-amazon.com/x.jpg", 210), // image -> skip
			entry("https://events.example.com/events", 220), // uplink -> skip
			entry("https://api.foo.com/infer", 230), // other -> count
			entry("https://cdn.example.com/early", 10), // pre-ready -> skip
		];
		expect(countBackendCalls(entries, OPTS)).toBe(2);
	});
});

// `toResourceEntries` is the runtime guard between the raw PerformanceEntry[]
// the browser hands the observer and the {name, startTime} slice the counter
// reads. Its contract is DEGRADE-and-skip, never throw: a malformed entry (the
// two read fields missing or the wrong type) is dropped, valid ones pass through.
describe("toResourceEntries", () => {
	it("passes valid entries through unchanged", () => {
		const raw = [
			{ name: "https://cdn.example.com/latest", startTime: 150 },
			{ name: "https://api.foo.com/infer", startTime: 230 },
		];
		expect(toResourceEntries(raw)).toEqual(raw);
	});

	it("skips entries with a non-string name", () => {
		const raw = [
			{ name: 42, startTime: 150 },
			{ name: "https://cdn.example.com/ok", startTime: 200 },
		];
		expect(toResourceEntries(raw)).toEqual([
			{ name: "https://cdn.example.com/ok", startTime: 200 },
		]);
	});

	it("skips entries with a non-number startTime", () => {
		const raw = [
			{ name: "https://cdn.example.com/bad", startTime: "soon" },
			{ name: "https://cdn.example.com/ok", startTime: 200 },
		];
		expect(toResourceEntries(raw)).toEqual([
			{ name: "https://cdn.example.com/ok", startTime: 200 },
		]);
	});

	it("skips entries missing a read field", () => {
		const raw = [
			{ name: "https://cdn.example.com/no-time" },
			{ startTime: 150 },
		];
		expect(toResourceEntries(raw)).toEqual([]);
	});

	it("skips non-object / nullish entries and never throws", () => {
		const raw = [
			null,
			undefined,
			"x",
			7,
			{ name: "https://ok.com", startTime: 1 },
		];
		expect(toResourceEntries(raw)).toEqual([
			{ name: "https://ok.com", startTime: 1 },
		]);
	});

	it("returns an empty list (not a throw) for an all-malformed batch", () => {
		expect(() => toResourceEntries([null, { name: 1 }, {}])).not.toThrow();
		expect(toResourceEntries([null, { name: 1 }, {}])).toEqual([]);
	});
});

// `startMetricsObservers` is the live wiring the pure helpers feed: a
// PerformanceObserver over "resource" entries plus a ~1s memory poll. It must
// degrade silently where the browser APIs are missing and return a cleanup that
// disconnects both. We stub the globals so jsdom can drive both branches.
type HeapPerformance = Performance & { memory?: { usedJSHeapSize: number } };

class FakeObserver {
	static instances: FakeObserver[] = [];
	observe = vi.fn();
	disconnect = vi.fn();
	readonly flush: () => void;
	constructor(flush: () => void) {
		this.flush = flush;
		FakeObserver.instances.push(this);
	}
}

function setHeapBytes(bytes: number | null): void {
	const perf = performance as HeapPerformance;
	if (bytes === null) {
		delete perf.memory;
	} else {
		perf.memory = { usedJSHeapSize: bytes };
	}
}

const LIVE_OPTS: ObserveOptions = {
	readyAt: 0,
	edgeOrigin: "https://cdn.example.com",
	eventsUrl: null,
};

describe("startMetricsObservers", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		FakeObserver.instances = [];
		vi.mocked(record).mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
		setHeapBytes(null);
	});

	it("subscribes a resource observer + memory poll and cleans both up", () => {
		vi.stubGlobal("PerformanceObserver", FakeObserver);
		vi.spyOn(performance, "getEntriesByType").mockReturnValue([
			{ name: "https://cdn.example.com/manifest", startTime: 5 },
		] as unknown as PerformanceEntryList);
		setHeapBytes(50 * 1024 * 1024); // 50 MB

		const stop = startMetricsObservers(LIVE_OPTS);

		const observer = FakeObserver.instances[0];
		expect(observer?.observe).toHaveBeenCalledWith({
			type: "resource",
			buffered: true,
		});
		// Initial heap sample recorded on start.
		expect(vi.mocked(record)).toHaveBeenCalledWith({ heapMb: 50 });

		// A flush recomputes the running post-ready backend-call total.
		observer?.flush();
		expect(vi.mocked(record)).toHaveBeenCalledWith({ backendCalls: 1 });

		// The poll re-samples the heap every second.
		setHeapBytes(60 * 1024 * 1024);
		vi.advanceTimersByTime(1000);
		expect(vi.mocked(record)).toHaveBeenCalledWith({ heapMb: 60 });

		// Cleanup disconnects the observer and stops the poll.
		stop();
		expect(observer?.disconnect).toHaveBeenCalledOnce();
		vi.mocked(record).mockClear();
		vi.advanceTimersByTime(3000);
		expect(vi.mocked(record)).not.toHaveBeenCalled();
	});

	it("degrades silently when PerformanceObserver + performance.memory are absent", () => {
		vi.stubGlobal("PerformanceObserver", undefined);
		setHeapBytes(null);

		const stop = startMetricsObservers(LIVE_OPTS);

		expect(FakeObserver.instances).toHaveLength(0);
		// No heap sample is fabricated when performance.memory is missing.
		expect(vi.mocked(record)).not.toHaveBeenCalled();
		expect(() => stop()).not.toThrow();
	});
});
