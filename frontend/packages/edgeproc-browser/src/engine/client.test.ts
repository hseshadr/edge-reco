// EngineClient failure semantics: a Worker that crashes before replying (init
// throw, load failure) must REJECT pending requests with a typed error — never
// hang — and a silent Worker is bounded by a per-request deadline backstop.

import { afterEach, describe, expect, it, vi } from "vitest";
import { EngineClient } from "./client";
import type { EngineRequest, EngineResponse } from "./protocol";
import { WorkerCrashError, WorkerTimeoutError } from "./workerFault";

type AnyListener = (event: unknown) => void;

/** In-memory Worker double: records posts, lets tests emit events. */
class FakeWorker {
	public readonly posted: EngineRequest[] = [];
	public terminated = false;
	readonly #listeners = new Map<string, AnyListener[]>();

	public postMessage(message: EngineRequest): void {
		this.posted.push(message);
	}

	public addEventListener(
		type: "message",
		listener: (event: MessageEvent<EngineResponse>) => void,
	): void;
	public addEventListener(
		type: "error",
		listener: (event: ErrorEvent) => void,
	): void;
	public addEventListener(
		type: "messageerror",
		listener: (event: MessageEvent) => void,
	): void;
	public addEventListener(type: string, listener: unknown): void {
		const existing = this.#listeners.get(type) ?? [];
		existing.push(listener as AnyListener);
		this.#listeners.set(type, existing);
	}

	public terminate(): void {
		this.terminated = true;
	}

	public emitMessage(response: EngineResponse): void {
		for (const listener of this.#listeners.get("message") ?? []) {
			listener({ data: response });
		}
	}

	public emitError(message: string): void {
		for (const listener of this.#listeners.get("error") ?? []) {
			listener({ message });
		}
	}

	public emitMessageError(): void {
		for (const listener of this.#listeners.get("messageerror") ?? []) {
			listener({ data: null });
		}
	}
}

afterEach(() => {
	vi.useRealTimers();
});

describe("EngineClient worker-crash rejection (no hang)", () => {
	it("rejects a pending sync with WorkerCrashError when the worker errors during init", async () => {
		const worker = new FakeWorker();
		const client = new EngineClient(worker);

		const pending = client.sync("http://edge/cat", "http://edge/key");
		const assertion = expect(pending).rejects.toBeInstanceOf(WorkerCrashError);
		worker.emitError("worker module failed to evaluate");
		await assertion;
	});

	it("rejects a pending request with WorkerCrashError on 'messageerror'", async () => {
		const worker = new FakeWorker();
		const client = new EngineClient(worker);

		const pending = client.readFile("catalog_meta.json");
		const assertion = expect(pending).rejects.toBeInstanceOf(WorkerCrashError);
		worker.emitMessageError();
		await assertion;
	});

	it("rejects requests issued AFTER a crash immediately (fail-fast latch)", async () => {
		const worker = new FakeWorker();
		const client = new EngineClient(worker);
		worker.emitError("boot exploded");

		await expect(
			client.sync("http://edge/cat", "http://edge/key"),
		).rejects.toBeInstanceOf(WorkerCrashError);
		// nothing was posted at a dead worker
		expect(worker.posted).toHaveLength(0);
	});
});

describe("EngineClient bounded response deadline (backstop)", () => {
	it("rejects with WorkerTimeoutError when a request outlives its deadline", async () => {
		vi.useFakeTimers();
		const worker = new FakeWorker();
		const client = new EngineClient(worker, { requestTimeoutMs: 5_000 });

		const pending = client.sync("http://edge/cat", "http://edge/key");
		const assertion =
			expect(pending).rejects.toBeInstanceOf(WorkerTimeoutError);
		vi.advanceTimersByTime(5_000);
		await assertion;
	});

	it("a reply before the deadline resolves normally and clears its timer", async () => {
		vi.useFakeTimers();
		const worker = new FakeWorker();
		const client = new EngineClient(worker, { requestTimeoutMs: 5_000 });

		const pending = client.readFile("catalog_meta.json");
		const id = worker.posted[0]?.id ?? -1;
		const bytes = new Uint8Array([1, 2, 3]);
		worker.emitMessage({ ok: true, id, kind: "readFile", bytes });
		await expect(pending).resolves.toEqual(bytes);

		// the cleared deadline must not fire anything afterwards
		vi.advanceTimersByTime(60_000);
	});
});
