// The PerformanceObserver wiring is hard to drive in jsdom, so the per-entry
// counting is factored into the pure `countBackendCalls` helper and tested here
// directly: edge/other count, image/uplink don't, pre-readyAt entries are
// ignored, and unparseable URLs fall through to "other" (i.e. counted).

import { describe, expect, it } from "vitest";
import { countBackendCalls, type ObserveOptions } from "./observe";

const READY_AT = 100;
const OPTS: ObserveOptions = {
	readyAt: READY_AT,
	edgeOrigin: "https://cdn.example.com",
	eventsUrl: "https://events.example.com/events",
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
