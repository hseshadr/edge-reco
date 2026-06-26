// Interaction-event UPLINK — the "flywheel" uplink half.
//
// Clicks are captured locally, persisted (so they survive a reload), and
// periodically flushed in batches to a "mimicked cloud" collector. This is an
// OPTIONAL, async, fire-and-forget BEACON that lives ENTIRELY OUTSIDE the
// search/recommend/sync/bootstrap (inference) path. It is OFF by default
// (`VITE_EVENTS_URL` unset) so the demo keeps its "zero backend calls after
// sync" headline, and it must NEVER throw or block the app.
//
// The core (`createUplink`) is DOM-free and fully injectable so every branch is
// unit-tested without a browser. The production singleton at the bottom wires
// it to localStorage / fetch / sendBeacon / timers / unload listeners.

import type { InteractionEvent } from "../api/types";
import { getSessionId } from "../session";

const STORAGE_KEY = "nimbus_uplink_queue";
const BATCH_SIZE = 25;
const MAX_QUEUE = 500;
const FLUSH_INTERVAL_MS = 10_000;

/** A cancel handle for a scheduled periodic callback. */
type StopTimer = () => void;

/** Everything the core needs, injected so tests need no DOM. */
export interface UplinkConfig {
	/** Collector URL. Undefined/empty → the uplink is fully disabled. */
	readonly url: string | undefined;
	readonly sessionId: string;
	readonly storage: Pick<Storage, "getItem" | "setItem">;
	/** POST a batch; resolve true on 2xx. Must never reject in practice. */
	readonly transport: (
		url: string,
		body: string,
		headers: Record<string, string>,
	) => Promise<boolean>;
	/** Unload-safe send (navigator.sendBeacon); returns whether it was queued. */
	readonly beacon: (url: string, body: string) => boolean;
	/** Install a periodic callback; return a cancel handle. */
	readonly schedule: (cb: () => void, ms: number) => StopTimer;
	readonly batchSize?: number;
	readonly maxQueue?: number;
	readonly flushIntervalMs?: number;
}

/** The uplink surface the app wiring drives. */
export interface Uplink {
	readonly enabled: boolean;
	enqueue(event: InteractionEvent): void;
	/** Flush pending events in batch-sized POSTs; never throws. */
	flush(): Promise<void>;
	/** Unload path: flush the whole queue via sendBeacon (best-effort, sync). */
	flushBeacon(): void;
	/** Subscribe to the cumulative count of events confirmed by the collector. */
	onSynced(callback: (total: number) => void): void;
	pendingCount(): number;
	stop(): void;
}

interface Envelope {
	readonly session_id: string;
	readonly events: ReadonlyArray<InteractionEvent>;
}

function envelope(
	sessionId: string,
	events: ReadonlyArray<InteractionEvent>,
): string {
	const payload: Envelope = { session_id: sessionId, events };
	return JSON.stringify(payload);
}

/** A disabled uplink: pure no-op, touches nothing (the default-demo path). */
function disabledUplink(): Uplink {
	return {
		enabled: false,
		enqueue: () => {},
		flush: () => Promise.resolve(),
		flushBeacon: () => {},
		onSynced: () => {},
		pendingCount: () => 0,
		stop: () => {},
	};
}

/**
 * Build an uplink over the injected transport/storage. Returns a no-op when
 * `config.url` is unset so the disabled path costs nothing and stays silent.
 */
export function createUplink(config: UplinkConfig): Uplink {
	const url = config.url;
	if (url === undefined || url === "") {
		return disabledUplink();
	}
	return new ActiveUplink(url, config);
}

/** The live uplink. Persists to storage, batches, and flushes off-path. */
class ActiveUplink implements Uplink {
	public readonly enabled = true;
	readonly #url: string;
	readonly #cfg: UplinkConfig;
	readonly #batchSize: number;
	readonly #maxQueue: number;
	readonly #stopTimer: StopTimer;
	#queue: InteractionEvent[];
	#syncedTotal = 0;
	#listeners: Array<(total: number) => void> = [];
	#inFlight: Promise<void> | null = null;

	public constructor(url: string, cfg: UplinkConfig) {
		this.#url = url;
		this.#cfg = cfg;
		this.#batchSize = cfg.batchSize ?? BATCH_SIZE;
		this.#maxQueue = cfg.maxQueue ?? MAX_QUEUE;
		this.#queue = this.#load();
		this.#stopTimer = cfg.schedule(() => {
			void this.flush();
		}, cfg.flushIntervalMs ?? FLUSH_INTERVAL_MS);
	}

	public enqueue(event: InteractionEvent): void {
		this.#queue.push(event);
		if (this.#queue.length > this.#maxQueue) {
			this.#queue = this.#queue.slice(this.#queue.length - this.#maxQueue);
		}
		this.#persist();
		if (this.#queue.length >= this.#batchSize) {
			void this.flush();
		}
	}

	public flush(): Promise<void> {
		if (this.#inFlight !== null) {
			return this.#inFlight;
		}
		this.#inFlight = this.#drain().finally(() => {
			this.#inFlight = null;
		});
		return this.#inFlight;
	}

	public flushBeacon(): void {
		if (this.#queue.length === 0) {
			return;
		}
		const ok = this.#cfg.beacon(
			this.#url,
			envelope(this.#cfg.sessionId, this.#queue),
		);
		if (ok) {
			this.#queue = [];
			this.#persist();
		}
	}

	public onSynced(callback: (total: number) => void): void {
		this.#listeners.push(callback);
	}

	public pendingCount(): number {
		return this.#queue.length;
	}

	public stop(): void {
		this.#stopTimer();
	}

	/** Send batch-sized POSTs until empty or a send fails; never throws. */
	async #drain(): Promise<void> {
		while (this.#queue.length > 0) {
			const batch = this.#queue.slice(0, this.#batchSize);
			const ok = await this.#send(batch);
			if (!ok) {
				return; // leave the batch at the front; retry next trigger
			}
			this.#queue = this.#queue.slice(batch.length);
			this.#persist();
			this.#syncedTotal += batch.length;
			this.#emit();
		}
	}

	async #send(batch: ReadonlyArray<InteractionEvent>): Promise<boolean> {
		const headers = {
			"Content-Type": "application/json",
			"X-Session-Id": this.#cfg.sessionId,
		};
		try {
			return await this.#cfg.transport(
				this.#url,
				envelope(this.#cfg.sessionId, batch),
				headers,
			);
		} catch {
			return false; // telemetry stays silent — never break the app
		}
	}

	#emit(): void {
		for (const listener of this.#listeners) {
			listener(this.#syncedTotal);
		}
	}

	#load(): InteractionEvent[] {
		const raw = this.#cfg.storage.getItem(STORAGE_KEY);
		if (raw === null || raw === "") {
			return [];
		}
		try {
			const parsed: unknown = JSON.parse(raw);
			return Array.isArray(parsed) ? (parsed as InteractionEvent[]) : [];
		} catch {
			return [];
		}
	}

	#persist(): void {
		this.#cfg.storage.setItem(STORAGE_KEY, JSON.stringify(this.#queue));
	}
}

// --- Production singleton wiring (DOM/env-bound; not unit-tested) -----------

let singleton: Uplink | null = null;

function realSchedule(cb: () => void, ms: number): StopTimer {
	const id = setInterval(cb, ms);
	return () => clearInterval(id);
}

async function realTransport(
	url: string,
	body: string,
	headers: Record<string, string>,
): Promise<boolean> {
	const response = await fetch(url, {
		method: "POST",
		keepalive: true,
		headers,
		body,
	});
	return response.ok;
}

function realBeacon(url: string, body: string): boolean {
	if (
		typeof navigator === "undefined" ||
		typeof navigator.sendBeacon !== "function"
	) {
		return false;
	}
	return navigator.sendBeacon(
		url,
		new Blob([body], { type: "application/json" }),
	);
}

/**
 * The lazily-built app-wide uplink. Reads `VITE_EVENTS_URL` (unset → disabled),
 * stamps batches with the persisted session id, and installs the unload
 * listeners once. Imported only by the data layer's `sendEvent`.
 */
export function getUplink(): Uplink {
	if (singleton !== null) {
		return singleton;
	}
	const url = import.meta.env.VITE_EVENTS_URL;
	if (url === undefined || url === "") {
		singleton = disabledUplink();
		return singleton;
	}
	const built = createUplink({
		url,
		sessionId: getSessionId(),
		storage: window.localStorage,
		transport: realTransport,
		beacon: realBeacon,
		schedule: realSchedule,
	});
	installUnloadFlush(built);
	singleton = built;
	return singleton;
}

/** Capture pending events on tab hide/close so a session is not lost. */
function installUnloadFlush(uplink: Uplink): void {
	if (typeof window === "undefined") {
		return;
	}
	const onHidden = (): void => uplink.flushBeacon();
	window.addEventListener("pagehide", onHidden);
	window.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "hidden") {
			onHidden();
		}
	});
}

/** Fire-and-forget capture for the data layer. Safe when disabled. */
export function enqueueUplink(event: InteractionEvent): void {
	getUplink().enqueue(event);
}

/** Subscribe to the cumulative synced count (for the SyncBadge). */
export function onUplinkSynced(callback: (total: number) => void): void {
	getUplink().onSynced(callback);
}

/** Whether the uplink is active (drives the badge's copy). */
export function uplinkEnabled(): boolean {
	return getUplink().enabled;
}
