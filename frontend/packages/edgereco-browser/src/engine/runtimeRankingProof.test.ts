import { describe, expect, it, vi } from "vitest";
import fixture from "./__fixtures__/ranking_proof_v1.json" with {
	type: "json",
};
import { DEFAULT_RANKING_CONFIG } from "./rankingConfig";
import {
	type EnginePort,
	type RuntimeDeps,
	readRankingProofEvidence,
} from "./runtime";

const ENCODER = new TextEncoder();
const PUBLIC_KEY_URL = "https://shop.example/public.key";

function hexBytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(/.{2}/gu) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	);
}

function port(): EnginePort {
	return {
		sync: () => Promise.reject(new Error("not used")),
		readFile: (path) =>
			path === "ranking_receipt.json"
				? Promise.resolve(ENCODER.encode(JSON.stringify(fixture)))
				: Promise.reject(new Error(`unexpected path ${path}`)),
	};
}

describe("runtime ranking proof", () => {
	it("reads the signed bundle receipt and verifies it under the pinned app key", async () => {
		const loadPublisherKey = vi.fn(() =>
			Promise.resolve(hexBytes(fixture.public_key)),
		);

		const evidence = await readRankingProofEvidence(
			port(),
			DEFAULT_RANKING_CONFIG,
			PUBLIC_KEY_URL,
			loadPublisherKey,
		);

		expect(loadPublisherKey).toHaveBeenCalledWith(PUBLIC_KEY_URL);
		expect(evidence.status).toBe("verified");
	});

	it("keeps bootstrap evidence available when the pinned key cannot load", async () => {
		const loadPublisherKey: NonNullable<RuntimeDeps["loadPublisherKey"]> = () =>
			Promise.reject(new Error("offline"));

		const evidence = await readRankingProofEvidence(
			port(),
			DEFAULT_RANKING_CONFIG,
			PUBLIC_KEY_URL,
			loadPublisherKey,
		);

		expect(evidence).toEqual({
			status: "unavailable",
			publisherSignature: "not_checked",
			configHash: "not_checked",
			reason: "key_unavailable",
		});
	});
});
