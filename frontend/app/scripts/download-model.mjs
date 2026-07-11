// Prebuild: self-host the MiniLM embedder weights so the storefront never
// depends on huggingface.co at runtime (house standard §8.1b — the aml-filter
// download-model mechanism, adapted).
//
// The in-browser engine (@edgeproc/browser) embeds the query with the
// transformers.js model `Xenova/all-MiniLM-L6-v2`. In the browser the pipeline
// pins `dtype: "q8"` (see packages/edgeproc-browser/src/engine/embedder.ts), so
// it requests `onnx/model_quantized.onnx` (~23 MB). With
// `env.allowLocalModels = true` + `env.localModelPath = "/models/"`,
// transformers.js resolves every file as
//   `/models/Xenova/all-MiniLM-L6-v2/<file>`
// i.e. pathJoin(localModelPath, modelId, file) — so the layout this script
// writes under app/public/models/ matches the runtime's request URLs
// byte-for-byte.
//
// This script is run by the app's `prebuild` npm hook, so `pnpm build` always
// materializes the weights into the SPA's public/ before Vite copies it into
// dist/. The weights are git-ignored (see app/.gitignore) — a portfolio reader
// runs `pnpm build` and the files appear locally; they are never committed
// (house standard §7: no tracked binaries >1MB).
//
// Deploy constraint: Cloudflare Pages rejects any single asset over 25 MiB
// (26,214,400 bytes). The q8 ONNX export is 22,972,370 bytes — under the limit
// with headroom — and download-model.test.mjs pins that constraint so a model
// bump that would break the deploy fails in the preflight suite, not on Pages.
//
// Integrity: each file is pinned to its SHA-256 digest (the same trust bar the
// signed catalog bundle uses — Ed25519 + SHA-256, fail-closed). A downloaded
// body is rejected unless its SHA-256 equals the pinned digest, and a bad body
// is never written to disk. Idempotent: a file already present is skipped only
// when its on-disk SHA-256 matches the pin — a present-but-corrupt/wrong file
// is refetched. Fail-loud: any HTTP error, hash mismatch, or exhausted retry
// aborts the build with a non-zero exit — a silent CDN fallback at runtime is
// exactly what we are eliminating, so a half-populated or wrong local mirror
// must never pass quietly.
//
// Bounded: every fetch is wrapped in a 60s AbortSignal.timeout plus a bounded
// retry (10 attempts, ~120s budget) that rides out rate-limiting and transient
// server faults — a 429 or 5xx (and a network error) is retried, honoring the
// server's `Retry-After` header (capped at 30s) when present, otherwise
// exponential backoff with jitter. A non-retryable status (e.g. 403/404) and an
// exhausted budget both fail loudly with a non-zero exit. The CDN is only ever
// touched at build time.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The transformers.js model id; its files live under this path on the HF hub. */
export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

/** The HF hub origin the prebuild (NOT the runtime) downloads weights from. */
export const HF_BASE = "https://huggingface.co";

/** Cloudflare Pages hard limit on a single deployed asset: 25 MiB. */
export const PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;

/** Per-fetch timeout (ms) and bounded-retry policy for a rate-limited/transient HF. */
export const FETCH_TIMEOUT_MS = 60_000;
// 10 attempts with the backoff below spans ~120s total (0.5+1+2+4+8+16+30+30+30s),
// enough to ride out a transient HF 429 burst on a cold-cache CI runner; a genuine
// outage still fails loudly after the budget rather than hanging.
export const MAX_ATTEMPTS = 10;
export const RETRY_BACKOFF_MS = 500;
/** Cap on any single retry wait (Retry-After or backoff) so we can't hang. */
export const RETRY_AFTER_CAP_MS = 30_000;

/**
 * The exact files transformers.js requests for a feature-extraction pipeline
 * with `dtype: "q8"`, each pinned to its SHA-256 digest (the source of truth
 * for integrity) plus its published byte size (kept for a friendly log and the
 * Pages-limit preflight test). The ONNX export is `model_quantized.onnx`
 * because the browser embedder pins the `q8` dtype.
 *
 * Provenance of the digests: the .onnx is an LFS file, so its digest is the
 * hub's published LFS oid (sha256) for `main` — the authoritative cryptographic
 * source. The four JSON files are not LFS; their digests were taken by
 * downloading them from the hub's `main` revision and are pinned here so any
 * future drift (or a corrupt/MITM'd body) is caught loudly.
 */
export const MODEL_FILES = Object.freeze([
	Object.freeze({
		path: "config.json",
		size: 650,
		sha256: "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
	}),
	Object.freeze({
		path: "tokenizer.json",
		size: 711661,
		sha256: "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
	}),
	Object.freeze({
		path: "tokenizer_config.json",
		size: 366,
		sha256: "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
	}),
	Object.freeze({
		path: "special_tokens_map.json",
		size: 125,
		sha256: "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3",
	}),
	Object.freeze({
		path: "onnx/model_quantized.onnx",
		size: 22972370,
		sha256: "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
	}),
]);

/** Where the mirrored weights land: app/public/models/<MODEL_ID>/<file>. */
export function modelDir() {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, "..", "public", "models", MODEL_ID);
}

/** The hub URL a given model-relative file is fetched from. */
export function sourceUrl(filePath) {
	return `${HF_BASE}/${MODEL_ID}/resolve/main/${filePath}`;
}

/** SHA-256 hex digest of a byte buffer — the integrity primitive for every file. */
export function sha256Hex(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Decide whether a file must be (re)downloaded. A file is skipped only when it is
 * present AND its on-disk SHA-256 equals the pinned digest — a missing, short, or
 * wrong-content file is refetched. Pure: the caller supplies the observed digest
 * (or undefined if the file is absent/unreadable).
 */
export function needsDownload(expectedSha256, actualSha256) {
	return actualSha256 !== expectedSha256;
}

/** On-disk SHA-256 of a file, or undefined if it is absent/unreadable. */
async function diskSha256(absPath) {
	try {
		return sha256Hex(await readFile(absPath));
	} catch {
		return undefined;
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 429 (rate limit) or any 5xx is transient and worth retrying; a 4xx is not. */
export function isRetryableStatus(status) {
	return status === 429 || status >= 500;
}

/**
 * Parse a `Retry-After` header into a wait in ms, capped at RETRY_AFTER_CAP_MS.
 * Accepts whole seconds or an HTTP-date; returns undefined for an absent,
 * negative, or unparseable value (so the caller falls back to computed backoff).
 */
export function parseRetryAfter(header) {
	if (!header) {
		return undefined;
	}
	const seconds = Number(header);
	if (Number.isInteger(seconds)) {
		return seconds >= 0
			? Math.min(seconds * 1000, RETRY_AFTER_CAP_MS)
			: undefined;
	}
	const at = Date.parse(header);
	if (Number.isNaN(at)) {
		return undefined;
	}
	return Math.min(Math.max(at - Date.now(), 0), RETRY_AFTER_CAP_MS);
}

/**
 * Wait before the next attempt: honor a server `Retry-After` (already parsed to
 * ms) when given, else exponential backoff (500ms · 2^(attempt-1)) plus full
 * jitter, all capped at RETRY_AFTER_CAP_MS so a retry can never hang forever.
 */
export function backoffDelay(attempt, retryAfterMs) {
	if (retryAfterMs !== undefined) {
		return Math.min(retryAfterMs, RETRY_AFTER_CAP_MS);
	}
	const base = RETRY_BACKOFF_MS * 2 ** (attempt - 1);
	return Math.min(base + Math.random() * RETRY_BACKOFF_MS, RETRY_AFTER_CAP_MS);
}

/** One attempt: throw on a non-OK status, returning bytes on success. */
async function fetchOnce(url, fetchImpl) {
	const res = await fetchImpl(url, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (!res.ok) {
		const err = new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`);
		err.status = res.status;
		err.retryAfter = parseRetryAfter(res.headers?.get?.("retry-after"));
		throw err;
	}
	return new Uint8Array(await res.arrayBuffer());
}

/** A thrown error is retryable if it carries no status (network) or a retryable one. */
function isRetryableError(err) {
	return err.status === undefined || isRetryableStatus(err.status);
}

/** Wait out a retryable failure, logging the backoff window chosen for it. */
async function waitBeforeRetry(url, attempt, err, sleepImpl) {
	const wait = backoffDelay(attempt, err.retryAfter);
	console.log(
		`  retry  ${url} (attempt ${attempt}: ${err.message}; ${wait}ms)`,
	);
	await sleepImpl(wait);
}

/** Re-raise a hard error verbatim, else throw a loud budget-exhausted error. */
function throwExhausted(url, err) {
	if (err.status !== undefined && !isRetryableStatus(err.status)) {
		throw err;
	}
	throw new Error(
		`GET ${url} failed after ${MAX_ATTEMPTS} attempts: ${err?.message}`,
	);
}

/**
 * Fetch a URL's body as bytes with a bounded timeout and bounded retry. A 429 or
 * 5xx (and a network error / stall) is retried up to MAX_ATTEMPTS, honoring
 * `Retry-After` when present else jittered exponential backoff; a non-retryable
 * status fails fast; an exhausted budget throws loudly.
 */
export async function fetchBytes(url, fetchImpl = fetch, sleepImpl = sleep) {
	let lastErr;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return await fetchOnce(url, fetchImpl);
		} catch (err) {
			lastErr = err;
			if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) {
				break;
			}
			await waitBeforeRetry(url, attempt, err, sleepImpl);
		}
	}
	return throwExhausted(url, lastErr);
}

/**
 * Verify a body against a pinned digest. Throws (a bad body must never be kept)
 * on mismatch; returns the verified bytes on success.
 */
export function verifyDigest(file, bytes) {
	const got = sha256Hex(bytes);
	if (got !== file.sha256) {
		throw new Error(
			`${file.path}: sha256 mismatch (got ${got}, expected ${file.sha256})`,
		);
	}
	return bytes;
}

async function downloadOne(file, destDir, fetchImpl = fetch) {
	const dest = join(destDir, file.path);
	const observed = await diskSha256(dest);
	if (!needsDownload(file.sha256, observed)) {
		console.log(`  skip   ${file.path} (sha256 verified)`);
		return;
	}
	const url = sourceUrl(file.path);
	const bytes = verifyDigest(file, await fetchBytes(url, fetchImpl));
	await mkdir(dirname(dest), { recursive: true });
	await writeFile(dest, bytes);
	console.log(`  fetch  ${file.path} (${bytes.byteLength} bytes, sha256 ok)`);
}

/** Download every model file into `destDir`, skipping ones already verified. */
export async function downloadModel(destDir, fetchImpl = fetch) {
	console.log(`Self-hosting ${MODEL_ID} weights into ${destDir}`);
	await mkdir(destDir, { recursive: true });
	for (const file of MODEL_FILES) {
		await downloadOne(file, destDir, fetchImpl);
	}
	console.log("Model weights ready (local, sha256-verified, no runtime CDN).");
}

const invokedDirectly =
	process.argv[1] !== undefined &&
	fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
	downloadModel(modelDir()).catch((err) => {
		console.error(`\nModel download FAILED: ${err.message}`);
		process.exit(1);
	});
}
