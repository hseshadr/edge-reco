import { starterPack } from "@edgeproc/errors";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bootErrorMessage, bundleErrorRegistry } from "./syncErrors";

/**
 * A faithful stand-in for a bundle-sync failure: the in-browser engine sets a
 * stable `.name` on each thrown class — `NetworkError` (fetchBytes.ts),
 * `IntegrityError` (integrity.ts), `SignatureError` (crypto.ts),
 * `WorkerTimeoutError` / `WorkerCrashError` (workerFault.ts). Classification
 * reads `.name` (duck-typed via the library's `errorNameOf`), so a name-tagged
 * Error exercises the exact runtime contract without importing the engine graph.
 */
function engineError(name: string, message: string): Error {
	const err = new Error(message);
	err.name = name;
	return err;
}

describe("@edgeproc/errors adoption — bundleErrorRegistry", () => {
	// Proves (1) the vendored library is really what does the work —
	// `bundleErrorRegistry` is a genuine @edgeproc/errors Registry built from its
	// `starterPack` codes; and (2) each engine error still maps to a canonical
	// code, so the classification vocabulary is the shared portfolio one.

	it("is a genuine @edgeproc/errors Registry built from the vendored starterPack", () => {
		for (const method of [
			"classify",
			"describe",
			"toProblemDetails",
			"create",
		] as const) {
			expect(
				typeof (bundleErrorRegistry as unknown as Record<string, unknown>)[
					method
				],
			).toBe("function");
		}
		// The reused codes ARE the vendored starter-pack codes, carrying the
		// vendored library's own default English (impossible to satisfy from
		// local-only logic).
		const reused = [
			"bundle.download_failed",
			"bundle.integrity_failed",
			"bundle.device_unsupported",
			"bundle.timeout",
			"net.unreachable",
			"internal.unknown",
		] as const;
		const pack = starterPack as Record<string, { en?: string }>;
		for (const code of reused) {
			expect(bundleErrorRegistry.has(code)).toBe(true);
			expect(Object.keys(starterPack)).toContain(code);
			expect(bundleErrorRegistry.get(code)?.en).toBe(pack[code]?.en);
		}
	});

	it("classifies each engine error name into the reused canonical code", () => {
		const code = (raw: unknown) => bundleErrorRegistry.classify(raw);
		expect(code(engineError("NetworkError", "origin unreachable"))).toBe(
			"bundle.download_failed",
		);
		expect(
			code(
				engineError(
					"IntegrityError",
					"manifest 9f3a failed content-address check",
				),
			),
		).toBe("bundle.integrity_failed");
		expect(code(engineError("SignatureError", "bad ed25519 signature"))).toBe(
			"bundle.integrity_failed",
		);
		expect(
			code(engineError("WorkerTimeoutError", "embedder worker timed out")),
		).toBe("bundle.timeout");
		expect(code(engineError("WorkerCrashError", "worker crashed"))).toBe(
			"bundle.device_unsupported",
		);
		// A raw fetch TypeError with no status + a network message → net.unreachable
		// (the starterPack's own message-based match, unchanged).
		expect(code(engineError("TypeError", "Failed to fetch"))).toBe(
			"net.unreachable",
		);
		// Anything unrecognized falls back to internal.unknown.
		expect(code(engineError("Error", "boom"))).toBe("internal.unknown");
		expect(code("weird string")).toBe("internal.unknown");
	});
});

describe("bootErrorMessage — behaviour-identical display", () => {
	// The BootScreen has always shown the engine's own message verbatim (App's
	// old `errorMessage` helper). Adoption must not change one on-screen byte: the
	// surfaced string stays the raw message; the non-Error fallback stays
	// "Unexpected error". Only a dev-facing coded console breadcrumb is new.
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns the raw Error message verbatim (unchanged from pre-adoption)", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(
			bootErrorMessage(engineError("NetworkError", "origin unreachable")),
		).toBe("origin unreachable");
		expect(
			bootErrorMessage(
				engineError(
					"IntegrityError",
					"manifest 9f3a failed content-address check",
				),
			),
		).toBe("manifest 9f3a failed content-address check");
		expect(bootErrorMessage(new Error("origin unreachable"))).toBe(
			"origin unreachable",
		);
	});

	it("falls back to 'Unexpected error' for a non-Error (unchanged)", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		expect(bootErrorMessage("weird")).toBe("Unexpected error");
		expect(bootErrorMessage(undefined)).toBe("Unexpected error");
	});

	it("routes through the registry, logging the canonical code for support", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		bootErrorMessage(
			engineError("IntegrityError", "manifest 9f3a failed check"),
		);
		expect(spy).toHaveBeenCalledWith(
			"[edge-reco:bundle.integrity_failed]",
			expect.any(Error),
		);
	});
});
