// The durable taste log — the ONE storage seam for interaction activity.
//
// Lego seam rule: every other module imports THIS file; the storage tech
// (OPFS) is named nowhere else in the app. Swapping the backing store touches
// this file only.
//
// WHAT: an append-only JSONL log of interaction events in the browser's own
// origin-private file system (OPFS: taste/events.jsonl) — the same durable
// local layer the engine already uses for the signed bundle. One versioned
// envelope per line:
//
//   {"v":1,"ts":"2026-…","type":"click","productId":"B0…","sessionId":"…"}
//
// NO PII: product ids, event types, timestamps, and the random per-browser
// session id (src/session.ts) only. Nothing ever leaves the device — this log
// exists so a reload can rebuild the taste profile by replaying the events
// through the same fold used live (api/client.ts bootstrap).
//
// RETENTION / COMPACTION POLICY: a rolling window of the last MAX_TASTE_EVENTS
// (500) events. Every append re-lands the capped tail in one atomic write
// (`createWritable` commits on close), so the file cannot grow unbounded and a
// torn write cannot destroy the previous generation.
//
// CORRUPTION: reads are per-line fail-soft — a line that does not parse or
// does not match the envelope is skipped (self-heal by dropping bad records;
// the next append rewrites a clean file). A failing storage layer degrades to
// session-only behavior — the seam NEVER throws into the interaction path.

import type { EventType } from "../api/types";
import { getSessionId } from "../session";

/** Rolling-window cap: the log keeps only the newest 500 events. */
export const MAX_TASTE_EVENTS = 500;

/** The versioned on-disk envelope, one JSONL line per interaction. */
export interface TasteEvent {
	readonly v: 1;
	readonly ts: string;
	readonly type: EventType;
	readonly productId: string;
	readonly sessionId: string;
}

/**
 * The minimal storage contract the seam needs: one text blob, atomically
 * replaced. Production is OPFS; tests inject an in-memory stand-in.
 */
export interface TasteLogBackend {
	/** The current file contents, or null when no log exists yet. */
	read(): Promise<string | null>;
	/** Atomically replace the file contents. */
	write(text: string): Promise<void>;
	/** Delete the file (a missing file is fine). */
	remove(): Promise<void>;
}

const LOG_DIR = "taste";
const LOG_FILE = "events.jsonl";
const EVENT_TYPES: ReadonlySet<string> = new Set([
	"click",
	"view",
	"favorite",
	"cart",
]);

/** OPFS main-thread backend; null where OPFS is unavailable (jsdom, old engines). */
function opfsBackend(): TasteLogBackend | null {
	if (
		typeof navigator === "undefined" ||
		typeof navigator.storage?.getDirectory !== "function"
	) {
		return null;
	}
	const openDir = async (): Promise<FileSystemDirectoryHandle> => {
		const root = await navigator.storage.getDirectory();
		return root.getDirectoryHandle(LOG_DIR, { create: true });
	};
	return {
		async read(): Promise<string | null> {
			const dir = await openDir();
			let handle: FileSystemFileHandle;
			try {
				handle = await dir.getFileHandle(LOG_FILE);
			} catch {
				return null; // no log yet — a fresh browser
			}
			const file = await handle.getFile();
			return file.text();
		},
		async write(text: string): Promise<void> {
			const dir = await openDir();
			const handle = await dir.getFileHandle(LOG_FILE, { create: true });
			// createWritable stages into a swap file and commits on close — an
			// interrupted write leaves the previous generation intact.
			const writable = await handle.createWritable();
			await writable.write(text);
			await writable.close();
		},
		async remove(): Promise<void> {
			const dir = await openDir();
			try {
				await dir.removeEntry(LOG_FILE);
			} catch {
				// Already gone — nothing to remove.
			}
		},
	};
}

// `undefined` = not resolved yet (resolve lazily); `null` = no storage.
let backend: TasteLogBackend | null | undefined;
// Serialize every operation: appends must not interleave with reads/clears.
let queue: Promise<unknown> = Promise.resolve();

/** Test seam: inject a backend (or null for "no storage"); undefined re-resolves. */
export function __setTasteLogBackendForTests(
	next: TasteLogBackend | null | undefined,
): void {
	backend = next;
	queue = Promise.resolve();
}

function resolveBackend(): TasteLogBackend | null {
	if (backend === undefined) {
		backend = opfsBackend();
	}
	return backend;
}

/** Run an operation on the serialized queue; storage failures degrade to `fallback`. */
function enqueue<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
	const next = queue.then(operation).catch((err: unknown) => {
		// Degrade to session-only behavior — never break the interaction path.
		console.warn("taste log unavailable, continuing without persistence", err);
		return fallback;
	});
	queue = next;
	return next;
}

/** Parse one JSONL line into a TasteEvent, or null for any invalid line. */
function parseLine(line: string): TasteEvent | null {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return null; // torn tail / not JSON — skip, never poison boot
	}
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const record = value as Record<string, unknown>;
	const valid =
		record.v === 1 &&
		typeof record.ts === "string" &&
		typeof record.type === "string" &&
		EVENT_TYPES.has(record.type) &&
		typeof record.productId === "string" &&
		record.productId !== "" &&
		typeof record.sessionId === "string";
	return valid ? (record as unknown as TasteEvent) : null;
}

function parseLog(text: string | null): TasteEvent[] {
	if (text === null || text === "") {
		return [];
	}
	const events: TasteEvent[] = [];
	for (const line of text.split("\n")) {
		if (line.trim() === "") {
			continue;
		}
		const event = parseLine(line);
		if (event !== null) {
			events.push(event);
		}
	}
	return events.slice(-MAX_TASTE_EVENTS);
}

function serialize(events: ReadonlyArray<TasteEvent>): string {
	return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

/**
 * Append one interaction to the durable log (fire-safe: a storage failure
 * degrades silently to session-only behavior). Read-modify-write under the
 * serial queue keeps the rolling window capped and self-heals corrupt lines.
 */
export function appendTasteEvent(
	type: EventType,
	productId: string,
): Promise<void> {
	const store = resolveBackend();
	if (store === null) {
		return Promise.resolve();
	}
	return enqueue(async () => {
		const events = parseLog(await store.read());
		events.push({
			v: 1,
			ts: new Date().toISOString(),
			type,
			productId,
			sessionId: getSessionId(),
		});
		await store.write(serialize(events.slice(-MAX_TASTE_EVENTS)));
	}, undefined);
}

/** All valid logged events, oldest first — the boot-time replay input. */
export function readTasteEvents(): Promise<ReadonlyArray<TasteEvent>> {
	const store = resolveBackend();
	if (store === null) {
		return Promise.resolve([]);
	}
	return enqueue(async () => parseLog(await store.read()), []);
}

/** Wipe the log (the "Reset taste" affordance). */
export function clearTasteLog(): Promise<void> {
	const store = resolveBackend();
	if (store === null) {
		return Promise.resolve();
	}
	return enqueue(() => store.remove(), undefined);
}
