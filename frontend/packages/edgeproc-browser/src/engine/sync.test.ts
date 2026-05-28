import { describe, expect, it } from "vitest";
import { canonicalBytes, type JsonValue } from "./canonical";
import { verifyEd25519 } from "./crypto";
import { catalogFetch, latestBytes, pubkeyRaw } from "./fixtures";
import { IntegrityError } from "./integrity";
import { MemoryCacheStore } from "./memoryStore";
import { materializeFile, syncIndex } from "./sync";
import type { IndexManifest, Verify, VersionPointer } from "./types";

const DECODER = new TextDecoder();
const PUBKEY = pubkeyRaw();

const realVerify: Verify = (message, signature) =>
	verifyEd25519(PUBKEY, message, signature);

function realPointer(): VersionPointer {
	return JSON.parse(DECODER.decode(latestBytes())) as VersionPointer;
}

async function loadManifest(
	store: MemoryCacheStore,
	hash: string,
): Promise<IndexManifest> {
	return JSON.parse(
		DECODER.decode(await store.getManifest(hash)),
	) as IndexManifest;
}

describe("syncIndex against the real examples/catalog bundle", () => {
	it("first run fetches every chunk, reuses none, and reassembles files byte-correct", async () => {
		const store = new MemoryCacheStore();
		const { fetchBytes } = catalogFetch();

		const result = await syncIndex({
			baseUrl: "/cat",
			store,
			fetchBytes,
			verify: realVerify,
		});

		expect(result.version).toBe("v1");
		expect(result.chunksReused).toBe(0);
		expect(result.chunksFetched).toBeGreaterThan(0);
		expect(result.bytesFetched).toBeGreaterThan(0);

		// promoted pointer matches the signed pointer
		const active = await store.readActive();
		expect(active?.manifest_hash).toBe(result.manifestHash);

		// every file reassembles + passes its file_sha256 check
		const manifest = await loadManifest(store, result.manifestHash);
		for (const entry of manifest.files) {
			const bytes = await materializeFile(store, manifest, entry.path);
			expect(bytes.byteLength).toBe(entry.size);
		}
	});

	it("re-run against a primed store fetches nothing (chunksFetched == 0)", async () => {
		const store = new MemoryCacheStore();
		const first = catalogFetch();
		await syncIndex({
			baseUrl: "/cat",
			store,
			fetchBytes: first.fetchBytes,
			verify: realVerify,
		});

		const second = catalogFetch();
		const result = await syncIndex({
			baseUrl: "/cat",
			store,
			fetchBytes: second.fetchBytes,
			verify: realVerify,
		});

		expect(result.chunksFetched).toBe(0);
		expect(result.bytesFetched).toBe(0);
		expect(result.chunksReused).toBeGreaterThan(0);
		expect(second.chunkRequests()).toHaveLength(0);
	});

	it("materializeFile returns catalog_meta.json as valid JSON", async () => {
		const store = new MemoryCacheStore();
		const { fetchBytes } = catalogFetch();
		const result = await syncIndex({
			baseUrl: "/cat",
			store,
			fetchBytes,
			verify: realVerify,
		});
		const manifest = await loadManifest(store, result.manifestHash);

		const bytes = await materializeFile(store, manifest, "catalog_meta.json");
		const meta = JSON.parse(DECODER.decode(bytes)) as Record<string, unknown>;
		expect(typeof meta).toBe("object");
	});
});

describe("syncIndex fail-closed behavior", () => {
	it("rejects a tampered pointer signature and promotes nothing", async () => {
		const store = new MemoryCacheStore();
		const pointer = realPointer();
		const tampered: VersionPointer = {
			...pointer,
			signature:
				(pointer.signature[0] === "A" ? "B" : "A") + pointer.signature.slice(1),
		};
		const fetchBytes = (url: string): Promise<Uint8Array> => {
			if (url.endsWith("/latest")) {
				return Promise.resolve(
					new TextEncoder().encode(JSON.stringify(tampered)),
				);
			}
			return Promise.reject(
				new Error(`should not fetch ${url} after a bad pointer`),
			);
		};

		await expect(
			syncIndex({ baseUrl: "/cat", store, fetchBytes, verify: realVerify }),
		).rejects.toThrow();
		expect(await store.readActive()).toBeNull();
	});

	it("rejects a manifest whose bytes do not hash to the pointer (content-address)", async () => {
		const store = new MemoryCacheStore();
		const pointer = realPointer();
		// keep the signature valid but serve a different manifest body
		const fetchBytes = (url: string): Promise<Uint8Array> => {
			if (url.endsWith("/latest")) {
				return Promise.resolve(latestBytes());
			}
			if (url.includes("/manifest/")) {
				return Promise.resolve(new TextEncoder().encode('{"tampered":true}'));
			}
			return Promise.reject(new Error(`unexpected ${url}`));
		};
		const verify: Verify = (message) => {
			// accept the real pointer message so we exercise the manifest check
			void message;
			return Promise.resolve();
		};
		void pointer;

		await expect(
			syncIndex({ baseUrl: "/cat", store, fetchBytes, verify }),
		).rejects.toBeInstanceOf(IntegrityError);
		expect(await store.readActive()).toBeNull();
	});

	it("a real pointer's canonical message verifies (parity guard inside sync)", async () => {
		const pointer = realPointer();
		const message = canonicalBytes(pointer as unknown as JsonValue, {
			exclude: { signature: true },
		});
		await expect(
			realVerify(message, pointer.signature),
		).resolves.toBeUndefined();
	});
});
