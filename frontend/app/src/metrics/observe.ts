// Live observers that feed the metrics store from real browser signals:
//   - PerformanceObserver on "resource" entries -> count POST-READY backend calls
//     (edge/other), excluding 3rd-party product images and the optional uplink
//     beacon. In the normal backend-free demo this stays 0 after sync.
//   - A ~1s memory poll -> main-thread JS heap (Chromium-only via
//     performance.memory). Left null on non-Chromium — never fabricated.
//
// All wiring is guarded so unsupported browsers (no PerformanceObserver, no
// performance.memory) degrade silently rather than throw.

import { classifyResource } from "./classify";
import { record } from "./store";

const MEMORY_POLL_MS = 1000;
const BYTES_PER_MB = 1024 * 1024;

export interface ObserveOptions {
	/** performance.now() captured when the engine became ready. */
	readonly readyAt: number;
	/** The signed-bundle CDN origin (VITE_BUNDLE_BASE_URL). */
	readonly edgeOrigin: string;
	/** The optional analytics uplink URL (VITE_EVENTS_URL); may be undefined. */
	readonly eventsUrl?: string | null | undefined;
}

/** The slice of a PerformanceResourceTiming the counter actually reads. */
interface ResourceEntryLike {
	readonly name: string;
	readonly startTime: number;
}

/**
 * Pure counting helper (unit-tested directly). Given the resource entries seen
 * so far and the classify options, return the count of entries that represent a
 * real backend call: classified "edge" or "other", and starting at/after
 * `readyAt`. Images and the uplink beacon are excluded; pre-ready entries (the
 * sync itself, the model fetch) are ignored.
 */
export function countBackendCalls(
	entries: readonly ResourceEntryLike[],
	opts: ObserveOptions,
): number {
	let count = 0;
	for (const entry of entries) {
		if (entry.startTime < opts.readyAt) {
			continue;
		}
		const bucket = classifyResource(entry.name, {
			edgeOrigin: opts.edgeOrigin,
			eventsUrl: opts.eventsUrl ?? null,
		});
		if (bucket === "edge" || bucket === "other") {
			count += 1;
		}
	}
	return count;
}

/** Narrow type for the Chromium-only `performance.memory` extension. */
type MemoryPerformance = Performance & {
	memory?: { usedJSHeapSize: number };
};

function readHeapMb(): number | null {
	if (typeof performance === "undefined") {
		return null;
	}
	const memory = (performance as MemoryPerformance).memory;
	if (memory === undefined) {
		return null;
	}
	return Math.round((memory.usedJSHeapSize / BYTES_PER_MB) * 10) / 10;
}

/**
 * Start the live metrics observers. Returns a cleanup function that disconnects
 * the observer and clears the memory poll. Safe to call in environments missing
 * PerformanceObserver/performance — it no-ops the unsupported parts.
 */
export function startMetricsObservers(opts: ObserveOptions): () => void {
	const stopResources = startResourceObserver(opts);
	const stopMemory = startMemoryPoll();
	return () => {
		stopResources();
		stopMemory();
	};
}

function startResourceObserver(opts: ObserveOptions): () => void {
	if (typeof PerformanceObserver === "undefined") {
		return () => {};
	}
	// On each flush, recompute the running total over ALL buffered resource
	// entries (getEntriesByType returns the full list), so the count is the
	// post-ready backend-call total regardless of how flushes batch.
	const observer = new PerformanceObserver(() => {
		const all = performance.getEntriesByType(
			"resource",
		) as unknown as ResourceEntryLike[];
		record({ backendCalls: countBackendCalls(all, opts) });
	});
	observer.observe({ type: "resource", buffered: true });
	return () => observer.disconnect();
}

function startMemoryPoll(): () => void {
	const initial = readHeapMb();
	if (initial === null) {
		return () => {};
	}
	record({ heapMb: initial });
	const id = setInterval(() => {
		const heapMb = readHeapMb();
		if (heapMb !== null) {
			record({ heapMb });
		}
	}, MEMORY_POLL_MS);
	return () => clearInterval(id);
}
