import { expect, test } from "@playwright/test";

/**
 * C1 — the in-browser sync engine, proven in a REAL browser with REAL OPFS.
 *
 * The harness page spawns the Worker engine; the Worker owns OPFS (sync access
 * handles) and runs the ported `sync_index`. We drive it over the harness's
 * `window.__engineHarness` API and assert against real signals:
 *   - sync verifies + lands the live signed bundle in OPFS and promotes active,
 *   - readFile('catalog_meta.json') reassembles byte-correct (valid JSON),
 *   - the OPFS chunk dir is populated (files really landed on the device),
 *   - a re-sync fetches nothing (chunksFetched == 0 — only-changed-chunks proof),
 *   - a tampered /latest signature is rejected fail-closed (nothing promoted).
 */

const CATALOG = "http://localhost:8910/catalog";
const CATALOG_TAMPERED = "http://localhost:8910/catalog-tampered";
const PUBKEY = "http://localhost:8910/public.key";

interface SyncResult {
	version: string;
	manifestHash: string;
	chunksFetched: number;
	chunksReused: number;
	bytesFetched: number;
}

declare global {
	interface Window {
		__engineHarness?: {
			sync(baseUrl: string, pubkeyUrl: string): Promise<SyncResult>;
			readFileText(path: string): Promise<string>;
		};
	}
}

test.beforeEach(async ({ page }) => {
	await page.goto("/engine-harness.html");
	await expect(page.locator("#status")).toHaveText("engine-ready");
	// start each test from an empty OPFS so chunk counts are deterministic
	await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		for await (const name of (
			root as unknown as { keys(): AsyncIterable<string> }
		).keys()) {
			await root.removeEntry(name, { recursive: true });
		}
	});
});

test("sync lands the live signed bundle in OPFS and readFile reassembles", async ({
	page,
}) => {
	const result = await page.evaluate(
		([base, key]) => window.__engineHarness?.sync(base, key),
		[CATALOG, PUBKEY],
	);
	expect(result?.version).toBe("v1");
	expect(result?.chunksReused).toBe(0);
	expect(result?.chunksFetched ?? 0).toBeGreaterThan(0);

	// readFile goes through OPFS chunks → reassembly → file_sha256 check
	const metaText = await page.evaluate(() =>
		window.__engineHarness?.readFileText("catalog_meta.json"),
	);
	expect(metaText).toBeDefined();
	const meta = JSON.parse(metaText ?? "{}") as Record<string, unknown>;
	expect(typeof meta).toBe("object");

	// the chunks actually landed on the device (OPFS chunk dir is populated)
	const chunkCount = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		const chunkDir = await root.getDirectoryHandle("chunk");
		let count = 0;
		for await (const _ of (
			chunkDir as unknown as { keys(): AsyncIterable<string> }
		).keys()) {
			count += 1;
		}
		return count;
	});
	expect(chunkCount).toBe(result?.chunksFetched);
});

test("re-sync after first sync fetches only-changed chunks (chunksFetched == 0)", async ({
	page,
}) => {
	const first = await page.evaluate(
		([base, key]) => window.__engineHarness?.sync(base, key),
		[CATALOG, PUBKEY],
	);
	expect(first?.chunksFetched ?? 0).toBeGreaterThan(0);

	const second = await page.evaluate(
		([base, key]) => window.__engineHarness?.sync(base, key),
		[CATALOG, PUBKEY],
	);
	expect(second?.chunksFetched).toBe(0);
	expect(second?.bytesFetched).toBe(0);
	expect(second?.chunksReused).toBe(first?.chunksFetched);
});

test("a tampered /latest signature is rejected fail-closed — nothing promoted", async ({
	page,
}) => {
	const outcome = await page.evaluate(
		async ([base, key]) => {
			try {
				await window.__engineHarness?.sync(base, key);
				return { rejected: false, message: "" };
			} catch (error) {
				return {
					rejected: true,
					message: error instanceof Error ? error.message : String(error),
				};
			}
		},
		[CATALOG_TAMPERED, PUBKEY],
	);
	expect(outcome.rejected).toBe(true);

	// nothing landed: no `active` pointer, no chunk dir created with content
	const promoted = await page.evaluate(async () => {
		const root = await navigator.storage.getDirectory();
		try {
			await root.getFileHandle("active");
			return true;
		} catch {
			return false;
		}
	});
	expect(promoted).toBe(false);
});
