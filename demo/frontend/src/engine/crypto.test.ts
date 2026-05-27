import { describe, expect, it } from "vitest";
import { canonicalBytes, type JsonValue } from "./canonical";
import { SignatureError, sha256Hex, verifyEd25519 } from "./crypto";
import { latestBytes, pubkeyRaw } from "./fixtures";
import type { VersionPointer } from "./types";

const DECODER = new TextDecoder();

function realPointer(): VersionPointer {
	return JSON.parse(DECODER.decode(latestBytes())) as VersionPointer;
}

describe("sha256Hex", () => {
	it("matches the known empty-string vector", async () => {
		expect(await sha256Hex(new Uint8Array(0))).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
		);
	});

	it("matches the known 'abc' vector", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});

describe("verifyEd25519 against the REAL committed pointer", () => {
	it("PASSES — proves canonical-bytes parity with the Python signer", async () => {
		const pointer = realPointer();
		const message = canonicalBytes(pointer as unknown as JsonValue, {
			exclude: { signature: true },
		});
		await expect(
			verifyEd25519(pubkeyRaw(), message, pointer.signature),
		).resolves.toBeUndefined();
	});

	it("THROWS fail-closed on a 1-byte-tampered signature", async () => {
		const pointer = realPointer();
		const message = canonicalBytes(pointer as unknown as JsonValue, {
			exclude: { signature: true },
		});
		// flip the first base64 char to a different valid base64 char
		const sig = pointer.signature;
		const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
		await expect(
			verifyEd25519(pubkeyRaw(), message, flipped),
		).rejects.toBeInstanceOf(SignatureError);
	});

	it("THROWS fail-closed when the signed message is tampered", async () => {
		const pointer = realPointer();
		const message = canonicalBytes(
			{ ...pointer, version: "v999" } as unknown as JsonValue,
			{
				exclude: { signature: true },
			},
		);
		await expect(
			verifyEd25519(pubkeyRaw(), message, pointer.signature),
		).rejects.toBeInstanceOf(SignatureError);
	});

	it("THROWS fail-closed on a malformed (non-base64) signature", async () => {
		const message = canonicalBytes({ a: 1 });
		await expect(
			verifyEd25519(pubkeyRaw(), message, "!!!not base64!!!"),
		).rejects.toBeInstanceOf(SignatureError);
	});
});
