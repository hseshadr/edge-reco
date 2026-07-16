import { Zstd } from "@hpcc-js/wasm-zstd";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "./crypto";
import { IntegrityError } from "./integrity";
import { MemoryCacheStore } from "./memoryStore";
import { RollbackError, syncIndex } from "./sync";
import type {
	FetchBytes,
	IndexManifest,
	Verify,
	VersionPointer,
} from "./types";

const ENCODER = new TextEncoder();
const passVerify: Verify = () => Promise.resolve();

interface SyntheticOrigin {
	readonly fetchBytes: FetchBytes;
	readonly pointer: VersionPointer;
	readonly requestCount: () => number;
}

async function originFor(
	manifest: IndexManifest,
	chunks: ReadonlyMap<string, Uint8Array> = new Map(),
	sequence = 1,
): Promise<SyntheticOrigin> {
	const manifestBytes = ENCODER.encode(JSON.stringify(manifest));
	const manifestHash = await sha256Hex(manifestBytes);
	const pointer: VersionPointer = {
		manifest_hash: manifestHash,
		version: manifest.version,
		bundle_id: manifest.bundle_id,
		channel: "stable",
		sequence,
		signature: "test-signature",
	};
	let requests = 0;
	const fetchBytes: FetchBytes = (url) => {
		requests += 1;
		if (url.endsWith("/latest")) {
			return Promise.resolve(ENCODER.encode(JSON.stringify(pointer)));
		}
		if (url.endsWith(`/manifest/${manifestHash}`)) {
			return Promise.resolve(manifestBytes);
		}
		const hash = url.split("/").at(-1);
		const compressed = hash === undefined ? undefined : chunks.get(hash);
		return compressed === undefined
			? Promise.reject(new Error(`unexpected ${url}`))
			: Promise.resolve(compressed);
	};
	return { fetchBytes, pointer, requestCount: () => requests };
}

function emptyManifest(overrides: Partial<IndexManifest> = {}): IndexManifest {
	return {
		schema_version: 2,
		bundle_id: "hardening-test",
		version: "v1",
		files: [],
		metadata: {},
		...overrides,
	};
}

function pointerFetch(
	origin: SyntheticOrigin,
	overrides: Partial<VersionPointer>,
): FetchBytes {
	return (url, options) => {
		if (url.endsWith("/latest")) {
			return Promise.resolve(
				ENCODER.encode(JSON.stringify({ ...origin.pointer, ...overrides })),
			);
		}
		return origin.fetchBytes(url, options);
	};
}

describe("signed monotonic pointer contract", () => {
	it("rejects a lower sequence before fetching its manifest", async () => {
		const origin = await originFor(emptyManifest(), new Map(), 5);
		const store = new MemoryCacheStore();
		await syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify });
		let requests = 0;
		const replay = pointerFetch(origin, { sequence: 4 });

		await expect(
			syncIndex({
				baseUrl: "/o",
				store,
				fetchBytes: (url, options) => {
					requests += 1;
					return replay(url, options);
				},
				verify: passVerify,
			}),
		).rejects.toBeInstanceOf(RollbackError);
		expect(requests).toBe(1);
		expect((await store.readActive())?.sequence).toBe(5);
	});

	it("rejects equal-sequence equivocation before fetching its manifest", async () => {
		const origin = await originFor(emptyManifest(), new Map(), 5);
		const store = new MemoryCacheStore();
		await syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify });
		let requests = 0;
		const fork = pointerFetch(origin, {
			manifest_hash: "f".repeat(64),
			version: "fork",
		});

		await expect(
			syncIndex({
				baseUrl: "/o",
				store,
				fetchBytes: (url, options) => {
					requests += 1;
					return fork(url, options);
				},
				verify: passVerify,
			}),
		).rejects.toBeInstanceOf(RollbackError);
		expect(requests).toBe(1);
	});

	it("requires a sequence on every incoming pointer", async () => {
		const origin = await originFor(emptyManifest());
		const store = new MemoryCacheStore();
		const sequenceLess: FetchBytes = (url, options) => {
			if (url.endsWith("/latest")) {
				const { sequence: _sequence, ...legacy } = origin.pointer;
				return Promise.resolve(ENCODER.encode(JSON.stringify(legacy)));
			}
			return origin.fetchBytes(url, options);
		};

		await expect(
			syncIndex({
				baseUrl: "/o",
				store,
				fetchBytes: sequenceLess,
				verify: passVerify,
			}),
		).rejects.toThrow(/sequence/iu);
		expect(await store.readActive()).toBeNull();
	});

	it("allows one migration from a cached legacy active pointer", async () => {
		const origin = await originFor(emptyManifest());
		const store = new MemoryCacheStore();
		const legacy = {
			manifest_hash: origin.pointer.manifest_hash,
			version: origin.pointer.version,
			signature: "legacy-signature",
		} as unknown as VersionPointer;
		await store.promote(legacy);

		await syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify });

		expect((await store.readActive())?.sequence).toBe(1);
	});
});

describe("bounded sync resources", () => {
	it("uses parallel chunk workers without exceeding eight in flight", async () => {
		const zstd = await Zstd.load();
		const chunks = new Map<string, Uint8Array>();
		const refs = [];
		for (let index = 0; index < 20; index += 1) {
			const bytes = ENCODER.encode(`bounded chunk ${index}`);
			const hash = await sha256Hex(bytes);
			refs.push({ hash, size: bytes.byteLength });
			chunks.set(hash, zstd.compress(bytes));
		}
		const file = ENCODER.encode(
			refs.map((_, index) => `bounded chunk ${index}`).join(""),
		);
		const manifest = emptyManifest({
			files: [
				{
					path: "chunks.bin",
					file_type: null,
					size: refs.reduce((total, ref) => total + ref.size, 0),
					file_sha256: await sha256Hex(file),
					chunks: refs,
				},
			],
		});
		const origin = await originFor(manifest, chunks);
		let inFlight = 0;
		let maximum = 0;
		const delayed: FetchBytes = async (url, options) => {
			if (!url.includes("/chunk/")) return origin.fetchBytes(url, options);
			inFlight += 1;
			maximum = Math.max(maximum, inFlight);
			await new Promise((resolve) => setTimeout(resolve, 5));
			try {
				return await origin.fetchBytes(url, options);
			} finally {
				inFlight -= 1;
			}
		};

		await syncIndex({
			baseUrl: "/o",
			store: new MemoryCacheStore(),
			fetchBytes: delayed,
			verify: passVerify,
		});

		expect(maximum).toBeGreaterThan(1);
		expect(maximum).toBeLessThanOrEqual(8);
	});

	it("rejects an excessive file count before fetching chunks", async () => {
		const files = Array.from({ length: 257 }, (_, index) => ({
			path: `f-${index}`,
			file_type: null,
			size: 0,
			file_sha256:
				"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
			chunks: [],
		}));
		const origin = await originFor(emptyManifest({ files }));
		const store = new MemoryCacheStore();

		await expect(
			syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify }),
		).rejects.toThrow(/file/iu);
		expect(origin.requestCount()).toBe(2);
		expect(await store.readActive()).toBeNull();
	});

	it("rejects aggregate fetched bytes before storing or promoting", async () => {
		const bytes = ENCODER.encode("larger than the injected aggregate ceiling");
		const hash = await sha256Hex(bytes);
		const zstd = await Zstd.load();
		const manifest = emptyManifest({
			files: [
				{
					path: "one.bin",
					file_type: null,
					size: bytes.byteLength,
					file_sha256: hash,
					chunks: [{ hash, size: bytes.byteLength }],
				},
			],
		});
		const origin = await originFor(
			manifest,
			new Map([[hash, zstd.compress(bytes)]]),
		);
		const store = new MemoryCacheStore();

		await expect(
			syncIndex({
				...origin,
				baseUrl: "/o",
				store,
				verify: passVerify,
				limits: { maxTotalFetchBytes: 1 },
			}),
		).rejects.toThrow(/aggregate/iu);
		expect(await store.hasChunk(hash)).toBe(false);
		expect(await store.readActive()).toBeNull();
	});

	it("bounds zstd output by the signed chunk size", async () => {
		const zstd = await Zstd.load();
		const bomb = new Uint8Array(9 * 1024 * 1024);
		const declared = new Uint8Array([0]);
		const hash = await sha256Hex(declared);
		const manifest = emptyManifest({
			files: [
				{
					path: "bomb.bin",
					file_type: null,
					size: 1,
					file_sha256: hash,
					chunks: [{ hash, size: 1 }],
				},
			],
		});
		const origin = await originFor(
			manifest,
			new Map([[hash, zstd.compress(bomb)]]),
		);
		const store = new MemoryCacheStore();

		await expect(
			syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify }),
		).rejects.toBeInstanceOf(IntegrityError);
		expect(await store.readActive()).toBeNull();
	});
});
