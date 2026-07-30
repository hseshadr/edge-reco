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

/**
 * Anti-rollback must be a PROOF of freshness, not the absence of disproof.
 *
 * Every case below is a REAL rollback driven through `syncIndex`: a validly
 * signed but stale `/latest` is replayed at a client whose durable pointer can
 * no longer prove how fresh it is. The guard used to answer "cannot compare"
 * with "then it is not a rollback" and promote the stale bundle — fail-OPEN,
 * the same defect class already fixed in edge-proc's `cas.py`. Proof must come
 * from a monotonic counter or a comparable version; neither speaking is a
 * refusal.
 */
describe("anti-rollback fails closed", () => {
	/** Replay `stale`'s signed pointer at a store already holding `active`. */
	function replay(
		store: MemoryCacheStore,
		stale: SyntheticOrigin,
	): Promise<unknown> {
		return syncIndex({
			baseUrl: "/o",
			store,
			fetchBytes: stale.fetchBytes,
			verify: passVerify,
		});
	}

	it("refuses a replay when the cached counter is present but unparseable", async () => {
		// Sequence 5 of v1 is live; the durable counter is then corrupted to a
		// non-integer — a tampered or truncated cache entry. An ABSENT counter is
		// the legacy-migration case and the version decides it; a PRESENT but
		// unparseable one is not. Here the version cannot decide either (same
		// release string, DIFFERENT manifest), so the only thing standing between
		// the client and the older bundle is refusing to read a corrupt counter as
		// proof. Isolated on purpose: nothing else in the guard can refuse this.
		const live = await originFor(
			emptyManifest({ version: "v1" }),
			new Map(),
			5,
		);
		const replayed = await originFor(
			emptyManifest({ version: "v1", metadata: { build: "older" } }),
			new Map(),
			4,
		);
		const store = new MemoryCacheStore();
		await syncIndex({ ...live, baseUrl: "/o", store, verify: passVerify });
		await store.promote({
			...live.pointer,
			sequence: null,
		} as unknown as VersionPointer);

		await expect(replay(store, replayed)).rejects.toBeInstanceOf(RollbackError);
		expect((await store.readActive())?.manifest_hash).toBe(
			live.pointer.manifest_hash,
		);
	});

	it("refuses a counter-less active whose version cannot prove freshness", async () => {
		// The literal finding: an UNPARSEABLE version used to bypass the check
		// instead of failing it. With no counter to compare and "nightly" not a
		// comparable release, nothing proves the incoming pointer is fresher.
		const origin = await originFor(emptyManifest({ version: "v1" }));
		const store = new MemoryCacheStore();
		await store.promote({
			manifest_hash: "b".repeat(64),
			version: "nightly",
			signature: "legacy-signature",
		} as unknown as VersionPointer);

		await expect(replay(store, origin)).rejects.toBeInstanceOf(RollbackError);
		expect((await store.readActive())?.version).toBe("nightly");
	});

	it("refuses an equal-version fork of a counter-less active pointer", async () => {
		// Equal versions prove freshness only for the SAME manifest. A different
		// manifest at the same version is an equivocating fork, and with no
		// counter there is nothing left to decide it.
		const origin = await originFor(emptyManifest({ version: "v1" }));
		const store = new MemoryCacheStore();
		await store.promote({
			manifest_hash: "c".repeat(64),
			version: "v1",
			signature: "legacy-signature",
		} as unknown as VersionPointer);

		await expect(replay(store, origin)).rejects.toBeInstanceOf(RollbackError);
		expect((await store.readActive())?.manifest_hash).toBe("c".repeat(64));
	});

	it("still promotes a provably fresher release over a counter-less active", async () => {
		// The fail-closed rule must not brick the legacy upgrade path: a
		// comparable, strictly newer version is proof, so v2 lands.
		const origin = await originFor(emptyManifest({ version: "v2" }));
		const store = new MemoryCacheStore();
		await store.promote({
			manifest_hash: "d".repeat(64),
			version: "v1",
			signature: "legacy-signature",
		} as unknown as VersionPointer);

		await syncIndex({ ...origin, baseUrl: "/o", store, verify: passVerify });

		expect((await store.readActive())?.version).toBe("v2");
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
		// One past the MAX_SYNC_FILES cap (1024): the file-count guard must fire
		// before any chunk fetch. Kept in lock-step with the cap in sync.ts.
		const files = Array.from({ length: 1025 }, (_, index) => ({
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
