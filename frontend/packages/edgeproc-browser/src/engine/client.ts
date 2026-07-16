// Thin main-thread client over the Worker engine. The main thread cannot touch
// OPFS sync access handles, so it only sends typed requests and awaits replies.
// One in-flight map keyed by request id correlates responses to promises.
//
// Failure semantics: a Worker that crashes before replying (init throw, script
// load failure) fires 'error'/'messageerror' but never posts a reply — so every
// in-flight request is rejected with a typed WorkerCrashError (and the client
// latches, failing subsequent requests fast). A silent Worker is bounded by a
// per-request response deadline that rejects with WorkerTimeoutError.

import type { EngineRequest, EngineResponse } from "./protocol";
import type { SyncResult } from "./types";
import {
	DEFAULT_REQUEST_TIMEOUT_MS,
	WorkerCrashError,
	WorkerTimeoutError,
} from "./workerFault";

/** The minimal Worker surface this client needs — small so tests can fake it. */
export interface EngineWorkerLike {
	postMessage(message: EngineRequest): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<EngineResponse>) => void,
	): void;
	addEventListener(
		type: "error",
		listener: (event: { message: string }) => void,
	): void;
	addEventListener(type: "messageerror", listener: () => void): void;
	terminate(): void;
}

/** Tuning knobs for the client (defaults suit the engine's sync/readFile calls). */
export interface EngineClientOptions {
	readonly requestTimeoutMs?: number;
}

interface Pending {
	readonly resolve: (response: EngineResponse) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export class EngineClient {
	readonly #worker: EngineWorkerLike;
	readonly #pending = new Map<number, Pending>();
	readonly #timeoutMs: number;
	#nextId = 0;
	#crash: WorkerCrashError | undefined;

	public constructor(
		worker: EngineWorkerLike,
		options: EngineClientOptions = {},
	) {
		this.#worker = worker;
		this.#timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
		this.#worker.addEventListener("message", (event) => {
			this.#onMessage(event.data);
		});
		this.#worker.addEventListener("error", (event) => {
			this.#onCrash(event.message);
		});
		this.#worker.addEventListener("messageerror", () => {
			this.#onCrash("a worker reply was not deserializable (messageerror)");
		});
	}

	/** Spawn the bundled engine Worker (module worker). */
	public static spawn(options?: EngineClientOptions): EngineClient {
		const worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
		return new EngineClient(worker, options);
	}

	/** Sync the signed bundle at `baseUrl`, pinning the raw pubkey at `pubkeyUrl`. */
	public async sync(
		baseUrl: string,
		pubkeyUrl: string,
		expectedBundleId = "amazon-demo",
		expectedChannel = "stable",
	): Promise<SyncResult> {
		const response = await this.#send({
			kind: "sync",
			id: this.#allocId(),
			baseUrl,
			pubkeyUrl,
			expectedBundleId,
			expectedChannel,
		});
		if (response.ok && response.kind === "sync") {
			return response.result;
		}
		throw new Error(this.#errorOf(response));
	}

	/** Materialize a synced file's bytes from the active manifest. */
	public async readFile(path: string): Promise<Uint8Array> {
		const response = await this.#send({
			kind: "readFile",
			id: this.#allocId(),
			path,
		});
		if (response.ok && response.kind === "readFile") {
			return response.bytes;
		}
		throw new Error(this.#errorOf(response));
	}

	public terminate(): void {
		this.#worker.terminate();
	}

	#allocId(): number {
		this.#nextId += 1;
		return this.#nextId;
	}

	#errorOf(response: EngineResponse): string {
		return response.ok ? "unexpected response kind" : response.error;
	}

	#send(request: EngineRequest): Promise<EngineResponse> {
		if (this.#crash !== undefined) {
			return Promise.reject(this.#crash);
		}
		return new Promise<EngineResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.#pending.delete(request.id);
				reject(
					new WorkerTimeoutError(
						`engine request ${request.id} (${request.kind}) exceeded ${this.#timeoutMs}ms`,
					),
				);
			}, this.#timeoutMs);
			this.#pending.set(request.id, { resolve, reject, timer });
			this.#worker.postMessage(request);
		});
	}

	#onMessage(response: EngineResponse): void {
		const pending = this.#pending.get(response.id);
		if (pending === undefined) {
			return;
		}
		this.#pending.delete(response.id);
		clearTimeout(pending.timer);
		pending.resolve(response);
	}

	#onCrash(reason: string): void {
		this.#crash ??= new WorkerCrashError(`engine worker crashed: ${reason}`);
		for (const pending of this.#pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(this.#crash);
		}
		this.#pending.clear();
	}
}
