import { describe, expect, it, vi } from "vitest";
import type { Embedder } from "./embedder";
import { type EnginePort, EngineRuntime, type RuntimeConfig } from "./runtime";
import type { SyncResult } from "./types";

const config: RuntimeConfig = {
	bundleBaseUrl: "https://edge.example/bundle",
	pubkeyUrl: "https://edge.example/public.key",
};

type DisposableEngine = EnginePort & { terminated: boolean; terminate(): void };
type DisposableEmbedder = Embedder & { disposed: boolean; dispose(): void };

function enginePort(
	options: {
		sync?: EnginePort["sync"];
		readFile?: EnginePort["readFile"];
	} = {},
): DisposableEngine {
	return {
		terminated: false,
		terminate() {
			this.terminated = true;
		},
		sync:
			options.sync ??
			(async () =>
				({
					version: "1",
					manifestHash: "a".repeat(64),
					chunksFetched: 0,
					chunksReused: 0,
					bytesFetched: 0,
				}) satisfies SyncResult),
		readFile:
			options.readFile ??
			(async (path: string) => {
				if (path === "ranking_config.json" || path === "cooccurrence.json") {
					throw new Error(`file ${path} not in manifest`);
				}
				return new Uint8Array();
			}),
	};
}

function rejectingEmbedder(error: Error): DisposableEmbedder {
	return {
		disposed: false,
		dispose() {
			this.disposed = true;
		},
		embed: vi.fn(() => Promise.reject(error)),
	};
}

describe("EngineRuntime resource lifecycle", () => {
	it("terminates the sync worker when bundle sync fails", async () => {
		const engine = enginePort({
			sync: () => Promise.reject(new Error("origin unavailable")),
		});
		const runtime = new EngineRuntime({
			spawnEngine: () => engine,
			makeEmbedder: () => {
				throw new Error("embedder should not be created");
			},
		});

		await expect(runtime.bootstrap(config)).rejects.toThrow(
			"origin unavailable",
		);
		expect(engine.terminated).toBe(true);
	});

	it("disposes both workers when model warmup times out", async () => {
		const engine = enginePort();
		const embedder = rejectingEmbedder(new Error("embed timeout"));
		const runtime = new EngineRuntime({
			spawnEngine: () => engine,
			makeEmbedder: () => {
				expect(engine.terminated).toBe(true);
				return embedder;
			},
		});

		await expect(runtime.bootstrap(config)).rejects.toThrow("embed timeout");
		expect(engine.terminated).toBe(true);
		expect(embedder.disposed).toBe(true);
	});

	it("starts a fresh worker pair after a failed bootstrap retry", async () => {
		const firstEngine = enginePort();
		const secondEngine = enginePort();
		const firstEmbedder = rejectingEmbedder(new Error("first boot failed"));
		const secondEmbedder = rejectingEmbedder(new Error("second boot failed"));
		const engines = [firstEngine, secondEngine];
		const embedders = [firstEmbedder, secondEmbedder];
		const runtime = new EngineRuntime({
			spawnEngine: () => engines.shift() ?? secondEngine,
			makeEmbedder: () => embedders.shift() ?? secondEmbedder,
		});

		await expect(runtime.bootstrap(config)).rejects.toThrow(
			"first boot failed",
		);
		await expect(runtime.bootstrap(config)).rejects.toThrow(
			"second boot failed",
		);
		expect(firstEngine.terminated).toBe(true);
		expect(firstEmbedder.disposed).toBe(true);
		expect(secondEngine.terminated).toBe(true);
		expect(secondEmbedder.disposed).toBe(true);
	});

	it("disposes active workers and invalidates an in-flight bootstrap", async () => {
		const engine = enginePort();
		let resolveWarmup: ((vector: Float32Array) => void) | undefined;
		const embedder: DisposableEmbedder = {
			disposed: false,
			dispose() {
				this.disposed = true;
			},
			embed: () =>
				new Promise<Float32Array>((resolve) => {
					resolveWarmup = resolve;
				}),
		};
		const runtime = new EngineRuntime({
			spawnEngine: () => engine,
			makeEmbedder: () => embedder,
		});

		const pending = runtime.bootstrap(config);
		await vi.waitFor(() => expect(resolveWarmup).toBeTypeOf("function"));
		runtime.dispose();
		expect(engine.terminated).toBe(true);
		expect(embedder.disposed).toBe(true);
		resolveWarmup?.(new Float32Array(384));
		await expect(pending).rejects.toThrow("disposed during bootstrap");
	});
});
