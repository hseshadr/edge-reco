// Content-address + signature primitives. Fail-closed by construction:
// verifyEd25519 throws on anything that is not a valid signature (mirrors
// edgeproc.bundles.signing.Ed25519Verifier, which raises SignatureError).

import { verifyAsync as nobleVerify } from "@noble/ed25519";

/** Raised when a signature is absent, malformed, or does not verify. */
export class SignatureError extends Error {
	public constructor(
		message = "signature verification failed",
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "SignatureError";
	}
}

function base64ToBytes(b64: string): Uint8Array {
	const binary = atob(b64);
	const out = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		out[i] = binary.charCodeAt(i);
	}
	return out;
}

/** Bare lowercase hex sha256 of `bytes` via WebCrypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
	const view = new Uint8Array(digest);
	let hex = "";
	for (const byte of view) {
		hex += byte.toString(16).padStart(2, "0");
	}
	return hex;
}

let webcryptoEd25519: boolean | null = null;

async function webcryptoSupportsEd25519(): Promise<boolean> {
	if (webcryptoEd25519 !== null) {
		return webcryptoEd25519;
	}
	try {
		await crypto.subtle.generateKey({ name: "Ed25519" }, false, [
			"sign",
			"verify",
		]);
		webcryptoEd25519 = true;
	} catch {
		webcryptoEd25519 = false;
	}
	return webcryptoEd25519;
}

async function verifyWebCrypto(
	pubkeyRaw32: Uint8Array,
	message: Uint8Array,
	signature: Uint8Array,
): Promise<boolean> {
	const key = await crypto.subtle.importKey(
		"raw",
		pubkeyRaw32 as BufferSource,
		{ name: "Ed25519" },
		false,
		["verify"],
	);
	return crypto.subtle.verify(
		"Ed25519",
		key,
		signature as BufferSource,
		message as BufferSource,
	);
}

/**
 * Fail-closed ed25519 verify against a pinned raw 32-byte public key.
 *
 * Uses WebCrypto `crypto.subtle.verify("Ed25519", ...)` where available and
 * falls back to `@noble/ed25519` otherwise. Resolves on a valid signature;
 * THROWS `SignatureError` on a bad/malformed signature or any verify error —
 * a forged pointer never escapes as a stray exception type.
 */
export async function verifyEd25519(
	pubkeyRaw32: Uint8Array,
	message: Uint8Array,
	signatureBase64: string,
): Promise<void> {
	let ok: boolean;
	try {
		const signature = base64ToBytes(signatureBase64);
		ok = (await webcryptoSupportsEd25519())
			? await verifyWebCrypto(pubkeyRaw32, message, signature)
			: await nobleVerify(signature, message, pubkeyRaw32);
	} catch (cause) {
		throw new SignatureError("signature verification failed", { cause });
	}
	if (!ok) {
		throw new SignatureError();
	}
}
