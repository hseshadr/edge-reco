// Thin main-thread client over the Worker engine. The main thread cannot touch
// OPFS sync access handles, so it only sends typed requests and awaits replies.
// One in-flight map keyed by request id correlates responses to promises.

import type { EngineRequest, EngineResponse } from "./protocol";
import type { SyncResult } from "./types";

interface Pending {
	readonly resolve: (response: EngineResponse) => void;
	readonly reject: (error: Error) => void;
}

export class EngineClient {
	readonly #worker: Worker;
	readonly #pending = new Map<number, Pending>();
	#nextId = 0;

	public constructor(worker: Worker) {
		this.#worker = worker;
		this.#worker.addEventListener(
			"message",
			(event: MessageEvent<EngineResponse>) => {
				this.#onMessage(event.data);
			},
		);
	}

	/** Spawn the bundled engine Worker (module worker). */
	public static spawn(): EngineClient {
		const worker = new Worker(new URL("./worker.ts", import.meta.url), {
			type: "module",
		});
		return new EngineClient(worker);
	}

	/** Sync the signed bundle at `baseUrl`, pinning the raw pubkey at `pubkeyUrl`. */
	public async sync(baseUrl: string, pubkeyUrl: string): Promise<SyncResult> {
		const response = await this.#send({
			kind: "sync",
			id: this.#allocId(),
			baseUrl,
			pubkeyUrl,
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
		return new Promise<EngineResponse>((resolve, reject) => {
			this.#pending.set(request.id, { resolve, reject });
			this.#worker.postMessage(request);
		});
	}

	#onMessage(response: EngineResponse): void {
		const pending = this.#pending.get(response.id);
		if (pending === undefined) {
			return;
		}
		this.#pending.delete(response.id);
		pending.resolve(response);
	}
}
