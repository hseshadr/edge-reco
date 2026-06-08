import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSnapshot, type MetricsSnapshot, record, subscribe } from "./store";

describe("MetricsSnapshot initial state", () => {
	it("starts with all latency fields null and backendCalls zero", () => {
		const snap = getSnapshot();
		expect(snap.searchMs).toBeNull();
		expect(snap.recommendMs).toBeNull();
		expect(snap.coldStartMs).toBeNull();
		expect(snap.heapMb).toBeNull();
		expect(snap.productCount).toBeNull();
		expect(snap.backendCalls).toBe(0);
	});
});

describe("record()", () => {
	// Save and restore the snapshot between tests by resetting to known state.
	// We do this by recording the original values back after each test.
	let before: MetricsSnapshot;

	beforeEach(() => {
		before = getSnapshot();
	});

	afterEach(() => {
		// Restore original state so tests are isolated
		record(before);
	});

	it("shallow-merges the patch into the current snapshot", () => {
		record({ searchMs: 42 });
		expect(getSnapshot().searchMs).toBe(42);
		// Other fields are untouched
		expect(getSnapshot().backendCalls).toBe(0);
	});

	it("notifies all subscribers on record", () => {
		const spy = vi.fn();
		const unsub = subscribe(spy);
		record({ searchMs: 10 });
		expect(spy).toHaveBeenCalledOnce();
		unsub();
	});

	it("notifies multiple subscribers", () => {
		const spy1 = vi.fn();
		const spy2 = vi.fn();
		const unsub1 = subscribe(spy1);
		const unsub2 = subscribe(spy2);
		record({ recommendMs: 20 });
		expect(spy1).toHaveBeenCalledOnce();
		expect(spy2).toHaveBeenCalledOnce();
		unsub1();
		unsub2();
	});

	it("creates a new snapshot object on each record call", () => {
		const snap1 = getSnapshot();
		record({ searchMs: 5 });
		const snap2 = getSnapshot();
		expect(snap2).not.toBe(snap1);
	});
});

describe("getSnapshot() reference stability", () => {
	it("returns the same object reference between record calls", () => {
		const ref1 = getSnapshot();
		const ref2 = getSnapshot();
		expect(ref1).toBe(ref2);
	});
});

describe("subscribe() / unsubscribe()", () => {
	it("does not notify an unsubscribed listener", () => {
		const spy = vi.fn();
		const unsub = subscribe(spy);
		unsub();
		record({ backendCalls: 1 });
		expect(spy).not.toHaveBeenCalled();
		// Clean up
		record({ backendCalls: 0 });
	});

	it("returns a function that can be called multiple times without error", () => {
		const unsub = subscribe(vi.fn());
		expect(() => {
			unsub();
			unsub();
		}).not.toThrow();
	});
});

describe("window.__edgeprocMetrics", () => {
	it("mirrors the current snapshot after record()", () => {
		record({ searchMs: 99 });
		expect(window.__edgeprocMetrics).toBeDefined();
		expect(window.__edgeprocMetrics?.searchMs).toBe(99);
		// Restore
		record({ searchMs: null });
	});

	it("window.__edgeprocMetrics is the same object as getSnapshot()", () => {
		record({ coldStartMs: 123 });
		expect(window.__edgeprocMetrics).toBe(getSnapshot());
		// Restore
		record({ coldStartMs: null });
	});
});
