/**
 * Bundle-sync error classification — edge-reco's adoption of the portfolio
 * canonical-errors standard (`@edgeproc/errors`, vendored at
 * `packages/edgeproc-errors`).
 *
 * The one user-facing failure the demo can actually hit is the one-time signed
 * catalog-bundle sync. The in-browser engine throws typed errors deep in that
 * pipeline — `NetworkError` (fetchBytes.ts), `IntegrityError` (integrity.ts),
 * `SignatureError` (crypto.ts), `WorkerTimeoutError` / `WorkerCrashError`
 * (workerFault.ts) — which propagate to App's boot `.catch`. This module is the
 * single place those raw failures are classified into stable canonical codes,
 * so a failure is loggable/greppable now and serializable to RFC 9457 Problem
 * Details later, in the shared portfolio vocabulary.
 *
 * Behaviour-identical: the BootScreen has always shown the engine's own message
 * verbatim, so `bootErrorMessage` preserves that exact string — no user-visible
 * copy and no i18n keys change. Only the classification vocabulary (and a
 * dev-facing coded console breadcrumb) is new.
 */

import {
	type Catalog,
	defineErrors,
	errorNameOf,
	starterPack,
} from "@edgeproc/errors";

/**
 * edge-reco's bundle-sync catalog, expressed in the shared `@edgeproc/errors`
 * vocabulary. Each code is REUSED from the library's `starterPack`; on top of
 * the starter data we attach a `match` predicate keyed on the engine's stable
 * error `.name`, so `classify()` reproduces the engine's fail-closed taxonomy.
 *
 * Registration ORDER is the precedence (`classify` returns the first code whose
 * `match` fires): a named engine error is matched before the starter pack's
 * generic message-based `net.unreachable` fallback, so a wrapped `NetworkError`
 * reads as a download failure rather than a bare network blip.
 */
const BUNDLE_ERROR_CATALOG = {
	// Content-address / signature / decompress failures — the bytes on disk do
	// not match their promised hash. `IntegrityError` and `SignatureError` are
	// the engine's two fail-closed integrity throws.
	"bundle.integrity_failed": {
		...starterPack["bundle.integrity_failed"],
		match: (raw: unknown) =>
			errorNameOf(raw) === "IntegrityError" ||
			errorNameOf(raw) === "SignatureError",
	},
	// A dead origin or non-ok HTTP status while pulling the pointer, manifest, or
	// a chunk — the engine's `NetworkError`.
	"bundle.download_failed": {
		...starterPack["bundle.download_failed"],
		match: (raw: unknown) => errorNameOf(raw) === "NetworkError",
	},
	// The embedding-model worker timed out while bootstrapping.
	"bundle.timeout": {
		...starterPack["bundle.timeout"],
		match: (raw: unknown) => errorNameOf(raw) === "WorkerTimeoutError",
	},
	// The worker crashed — commonly a device/browser that cannot run the WASM
	// engine at all.
	"bundle.device_unsupported": {
		...starterPack["bundle.device_unsupported"],
		match: (raw: unknown) => errorNameOf(raw) === "WorkerCrashError",
	},
	// A no-status fetch failure (offline) — the starter pack's own message-based
	// match, kept as the generic network fallback.
	"net.unreachable": starterPack["net.unreachable"],
	"internal.unknown": starterPack["internal.unknown"],
} satisfies Catalog;

/**
 * edge-reco's bundle-sync error registry — the single place raw engine/transport
 * failures are classified into canonical codes, built with the shared
 * `@edgeproc/errors` library. Exported so the classification is inspectable and
 * testable as the library's own `Registry` (and so a server surface can later
 * reuse the same codes for RFC 9457 Problem Details without re-deriving them).
 */
export const bundleErrorRegistry = defineErrors(BUNDLE_ERROR_CATALOG);

/**
 * The user-facing message for a boot/sync failure — what `BootScreen` renders.
 *
 * Behaviour-identical to the pre-adoption `App.errorMessage` helper: it surfaces
 * the engine's own message verbatim (and the same `"Unexpected error"` fallback
 * for a non-Error), so not one on-screen byte changes. The only new work is
 * routing the failure through the canonical registry to log a stable, greppable
 * code for support correlation — a dev-facing breadcrumb, never rendered.
 */
export function bootErrorMessage(err: unknown): string {
	console.error(`[edge-reco:${bundleErrorRegistry.classify(err)}]`, err);
	return err instanceof Error ? err.message : "Unexpected error";
}
