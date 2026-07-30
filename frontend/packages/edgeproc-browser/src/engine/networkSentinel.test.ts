// The sentinel is what makes a Worker's network activity visible to the tab.
// jsdom has neither PerformanceObserver nor a Worker scope, so the live wiring
// is driven with stubbed globals (the same pattern the app's metrics observer
// uses) and the pure conversion/guard helpers are tested directly. The REAL
// end-to-end proof — a genuine fetch inside the app's running Worker moving the
// on-screen counter — is the Playwright spec app/tests/e2e-offline/
// worker-network-guard.spec.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	installNetworkSentinel,
	isNetworkSentinelReport,
	NETWORK_SENTINEL_CHANNEL,
	NETWORK_SENTINEL_REPORT_KIND,
	type NetworkSentinelReport,
	toSentinelEntries,
} from "./networkSentinel";

const TIME_ORIGIN = 1_700_000_000_000;

describe("toSentinelEntries", () => {
	it("stamps each entry on the shared epoch clock", () => {
		const raw = [{ name: "https://api.example.com/infer", startTime: 250 }];
		expect(toSentinelEntries(raw, TIME_ORIGIN)).toEqual([
			{
				name: "https://api.example.com/infer",
				startedAtEpochMs: TIME_ORIGIN + 250,
			},
		]);
	});

	it("drops malformed entries instead of throwing", () => {
		// Contract: a PerformanceObserver callback must never throw, so a browser
		// handing back an unexpected shape degrades to "skip that entry".
		const raw = [
			null,
			"nope",
			{ name: 7, startTime: 1 },
			{ name: "https://ok.example.com/a" },
			{ startTime: 1 },
			{ name: "https://ok.example.com/b", startTime: 5 },
		];
		expect(toSentinelEntries(raw, TIME_ORIGIN)).toEqual([
			{ name: "https://ok.example.com/b", startedAtEpochMs: TIME_ORIGIN + 5 },
		]);
	});
});

describe("isNetworkSentinelReport", () => {
	const report: NetworkSentinelReport = {
		kind: NETWORK_SENTINEL_REPORT_KIND,
		context: "embedder-worker",
		entries: [],
	};

	it("accepts a well-formed report", () => {
		expect(isNetworkSentinelReport(report)).toBe(true);
	});

	it("rejects anything else on the channel", () => {
		// The channel is same-origin, which is NOT the same as trusted: any script
		// in the origin can post here, so shape is proven before a report counts.
		expect(isNetworkSentinelReport({ ...report, kind: "other" })).toBe(false);
		expect(isNetworkSentinelReport({ ...report, context: 1 })).toBe(false);
		expect(isNetworkSentinelReport({ ...report, entries: "many" })).toBe(false);
		expect(isNetworkSentinelReport(null)).toBe(false);
		expect(isNetworkSentinelReport("report")).toBe(false);
	});
});

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

class FakeChannel {
	static instances: FakeChannel[] = [];
	readonly posted: unknown[] = [];
	readonly name: string;
	close = vi.fn();
	constructor(name: string) {
		this.name = name;
		FakeChannel.instances.push(this);
	}
	postMessage(message: unknown): void {
		this.posted.push(message);
	}
}

describe("installNetworkSentinel", () => {
	beforeEach(() => {
		FakeObserver.instances = [];
		FakeChannel.instances = [];
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("broadcasts this context's full resource view on every flush", () => {
		vi.stubGlobal("PerformanceObserver", FakeObserver);
		vi.stubGlobal("BroadcastChannel", FakeChannel);
		vi.spyOn(performance, "getEntriesByType").mockReturnValue([
			{ name: "https://api.example.com/leak", startTime: 40 },
		] as unknown as PerformanceEntryList);
		vi.spyOn(performance, "timeOrigin", "get").mockReturnValue(TIME_ORIGIN);

		const stop = installNetworkSentinel("embedder-worker");

		const channel = FakeChannel.instances[0];
		expect(channel?.name).toBe(NETWORK_SENTINEL_CHANNEL);
		expect(FakeObserver.instances[0]?.observe).toHaveBeenCalledWith({
			type: "resource",
			buffered: true,
		});

		FakeObserver.instances[0]?.flush();
		expect(channel?.posted).toEqual([
			{
				kind: NETWORK_SENTINEL_REPORT_KIND,
				context: "embedder-worker",
				entries: [
					{
						name: "https://api.example.com/leak",
						startedAtEpochMs: TIME_ORIGIN + 40,
					},
				],
			},
		]);

		// Cleanup disconnects BEFORE closing, so no flush can post to a closed
		// channel.
		stop();
		expect(FakeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce();
		expect(channel?.close).toHaveBeenCalledOnce();
	});

	it("degrades to a no-op where the browser lacks the APIs", () => {
		vi.stubGlobal("PerformanceObserver", undefined);
		vi.stubGlobal("BroadcastChannel", FakeChannel);

		const stop = installNetworkSentinel("engine-worker");

		expect(FakeChannel.instances).toHaveLength(0);
		expect(() => stop()).not.toThrow();
	});

	it("degrades to a no-op without BroadcastChannel", () => {
		vi.stubGlobal("PerformanceObserver", FakeObserver);
		vi.stubGlobal("BroadcastChannel", undefined);

		const stop = installNetworkSentinel("engine-worker");

		expect(FakeObserver.instances).toHaveLength(0);
		expect(() => stop()).not.toThrow();
	});
});
