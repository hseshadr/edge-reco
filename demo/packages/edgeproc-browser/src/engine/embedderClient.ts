// Main-thread client that drives the embedder Worker. Presents the same Embedder
// interface as the in-process embedder so the search engine is agnostic to where
// the model runs; the Worker keeps model load + inference off the UI thread.

import type { Embedder } from "./embedder";
import type { EmbedRequest, EmbedResponse } from "./embedderWorker";

/** A minimal Worker surface — what this client needs, so it is easy to fake. */
export interface WorkerLike {
	postMessage(
		message: EmbedRequest,
		transfer: ReadonlyArray<Transferable>,
	): void;
	addEventListener(
		type: "message",
		listener: (event: MessageEvent<EmbedResponse>) => void,
	): void;
}

/** Spawns the embedder Worker as an ES module. */
export function spawnEmbedderWorker(): Worker {
	return new Worker(new URL("./embedderWorker.ts", import.meta.url), {
		type: "module",
	});
}

class WorkerEmbedder implements Embedder {
	readonly #worker: WorkerLike;
	readonly #pending = new Map<
		number,
		{ resolve: (v: Float32Array) => void; reject: (e: Error) => void }
	>();
	#nextId = 0;

	public constructor(worker: WorkerLike) {
		this.#worker = worker;
		this.#worker.addEventListener("message", (event) => {
			this.#settle(event.data);
		});
	}

	#settle(response: EmbedResponse): void {
		const entry = this.#pending.get(response.id);
		if (entry === undefined) {
			return;
		}
		this.#pending.delete(response.id);
		if (response.ok) {
			entry.resolve(response.vector);
		} else {
			entry.reject(new Error(response.error));
		}
	}

	public embed(text: string): Promise<Float32Array> {
		const id = this.#nextId;
		this.#nextId += 1;
		return new Promise<Float32Array>((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			this.#worker.postMessage({ id, text }, []);
		});
	}
}

/** Wrap a Worker (or Worker-like) as an Embedder. */
export function createWorkerEmbedder(worker: WorkerLike): Embedder {
	return new WorkerEmbedder(worker);
}
