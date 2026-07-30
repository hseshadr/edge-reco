// Worker-aware network sentinel.
//
// THE PROBLEM IT EXISTS FOR: every browsing context keeps its OWN resource-
// timing timeline. A `PerformanceObserver` on the window therefore sees NOTHING
// a Web Worker fetches — and in this engine the pipeline runs in Workers. A
// "no network after sync" counter built only on the window is blind exactly
// where the interesting traffic would be: a request issued inside a Worker
// leaves the browser while the counter still reads zero.
//
// THE SEAM: each Worker the app owns calls `installNetworkSentinel()` once at
// startup. It observes that Worker's own resource timeline and broadcasts what
// it sees on a same-origin BroadcastChannel; the main thread merges those
// reports with its own entries before counting. BroadcastChannel (rather than
// postMessage) keeps this completely off the Workers' RPC protocols — adding
// the sentinel is one import and one call per Worker, and removing it is the
// same edit.
//
// TIME: `entry.startTime` is relative to the reporting context's own
// `timeOrigin`, which differs per Worker. Reports therefore carry the EPOCH
// timestamp (`timeOrigin + startTime`), the one clock every context shares, and
// the reader rebases it onto its own timeline.
//
// FAILURE MODE: degrade, never throw. A browser missing PerformanceObserver or
// BroadcastChannel silently reports nothing rather than breaking the Worker
// that hosts it.

/// <reference lib="webworker" />

/** The same-origin channel every context publishes and reads sentinel reports on. */
export const NETWORK_SENTINEL_CHANNEL = "edgeproc:network-sentinel";

/** Discriminator for a sentinel report; the channel carries nothing else. */
export const NETWORK_SENTINEL_REPORT_KIND = "network-sentinel-report";

/** One observed network request, timestamped on the shared epoch clock. */
export interface SentinelEntry {
	readonly name: string;
	/** `performance.timeOrigin + entry.startTime` — comparable across contexts. */
	readonly startedAtEpochMs: number;
}

/** A context's full view of its own network activity so far. */
export interface NetworkSentinelReport {
	readonly kind: typeof NETWORK_SENTINEL_REPORT_KIND;
	/** Which context reported, so a reader can replace rather than accumulate. */
	readonly context: string;
	readonly entries: readonly SentinelEntry[];
}

/**
 * Narrow the raw `PerformanceEntry[]` a browser hands the observer to the
 * epoch-stamped slice a report carries. Same DEGRADE-and-skip contract as the
 * window-side guard: an entry missing either read field, or of the wrong type,
 * is dropped — throwing here would escape the observer callback.
 */
export function toSentinelEntries(
	raw: readonly unknown[],
	timeOrigin: number,
): readonly SentinelEntry[] {
	const out: SentinelEntry[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) {
			continue;
		}
		const { name, startTime } = entry as Record<string, unknown>;
		if (typeof name === "string" && typeof startTime === "number") {
			out.push({ name, startedAtEpochMs: timeOrigin + startTime });
		}
	}
	return out;
}

/**
 * Runtime guard for a message arriving off the channel. Same-origin is not the
 * same as trusted — any script in the origin can post here — so a report is
 * only counted once its shape is proven.
 */
export function isNetworkSentinelReport(
	value: unknown,
): value is NetworkSentinelReport {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const { kind, context, entries } = value as Record<string, unknown>;
	return (
		kind === NETWORK_SENTINEL_REPORT_KIND &&
		typeof context === "string" &&
		Array.isArray(entries)
	);
}

/** The globals the sentinel needs; absent in non-browser or older runtimes. */
function sentinelUnsupported(): boolean {
	return (
		typeof PerformanceObserver === "undefined" ||
		typeof BroadcastChannel === "undefined" ||
		typeof performance === "undefined"
	);
}

function publish(channel: BroadcastChannel, context: string): void {
	const report: NetworkSentinelReport = {
		kind: NETWORK_SENTINEL_REPORT_KIND,
		context,
		entries: toSentinelEntries(
			performance.getEntriesByType("resource"),
			performance.timeOrigin,
		),
	};
	channel.postMessage(report);
}

/**
 * Start reporting this context's network activity. Call once, at the top of a
 * Worker entry module. Returns a cleanup function; no-ops where unsupported.
 *
 * Each flush re-reads and broadcasts the FULL buffered list rather than a
 * delta, so a reader that subscribes late still receives everything on the next
 * flush and can replace this context's slice wholesale.
 */
export function installNetworkSentinel(context: string): () => void {
	if (sentinelUnsupported()) {
		return () => {};
	}
	const channel = new BroadcastChannel(NETWORK_SENTINEL_CHANNEL);
	const observer = new PerformanceObserver(() => {
		publish(channel, context);
	});
	observer.observe({ type: "resource", buffered: true });
	// Disconnect BEFORE closing so no flush can ever post to a closed channel.
	return () => {
		observer.disconnect();
		channel.close();
	};
}
