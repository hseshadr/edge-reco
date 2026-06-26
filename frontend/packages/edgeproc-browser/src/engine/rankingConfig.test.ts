import { describe, expect, it } from "vitest";
import { catalogFetch, latestBytes } from "./fixtures";
import { MemoryCacheStore } from "./memoryStore";
import { DEFAULT_RANKING_CONFIG, parseRankingConfig } from "./rankingConfig";
import { materializeFile, syncIndex } from "./sync";
import type { IndexManifest, Verify, VersionPointer } from "./types";

const acceptVerify: Verify = () => Promise.resolve();
const DECODER = new TextDecoder();

/** Read ranking_config.json out of the committed bundle via the verified path. */
async function syncedRankingConfigBytes(): Promise<Uint8Array> {
	const store = new MemoryCacheStore();
	const { fetchBytes } = catalogFetch();
	const result = await syncIndex({
		baseUrl: "/cat",
		store,
		fetchBytes,
		verify: acceptVerify,
	});
	void (JSON.parse(DECODER.decode(latestBytes())) as VersionPointer);
	const manifest = JSON.parse(
		DECODER.decode(await store.getManifest(result.manifestHash)),
	) as IndexManifest;
	return materializeFile(store, manifest, "ranking_config.json");
}

describe("DEFAULT_RANKING_CONFIG", () => {
	it("reproduces today's hardcoded scoring weights", () => {
		expect(DEFAULT_RANKING_CONFIG.scoring_weights).toEqual({
			popularity: 0.4,
			category: 0.2,
			tag: 0.15,
			brand: 0.1,
			freshness: 0.1,
			repetition_penalty: 0.25,
			// similarity: 0 ⇒ the for_you/default formula reduces to today's exactly.
			similarity: 0,
			// cooccurrence: 0 ⇒ Phase-3 term off for the default/for_you formula.
			cooccurrence: 0,
		});
	});

	it("reproduces today's hardcoded interaction weights", () => {
		expect(DEFAULT_RANKING_CONFIG.interaction_weights).toEqual({
			click: { category: 0.1, tag: 0.05, brand: 0.08 },
			view: { category: 0.02, tag: 0.01, brand: 0.02 },
			favorite: { category: 0.2, tag: 0.1, brand: 0.15 },
			cart: { category: 0.25, tag: 0.12, brand: 0.2 },
		});
	});

	it("carries the schema version", () => {
		expect(DEFAULT_RANKING_CONFIG.schema_version).toBe(3);
	});

	it("ships the seven strategies with the backend's weights", () => {
		const strategies = DEFAULT_RANKING_CONFIG.strategies ?? {};
		expect(Object.keys(strategies).sort()).toEqual([
			"also_bought",
			"because_viewed",
			"for_you",
			"frequently_bought_together",
			"new_arrivals",
			"similar_items",
			"trending",
		]);
		// for_you reuses the top-level weights verbatim (Phase-1 parity). The Python
		// producer serializes co_occurrence_top_k (its None default) on every
		// strategy, so the default mirrors that JSON byte-for-byte.
		expect(strategies.for_you).toEqual({
			label: "Recommended for you",
			candidate_policy: "affinity_first",
			weights: DEFAULT_RANKING_CONFIG.scoring_weights,
			co_occurrence_top_k: null,
		});
		expect(strategies.trending?.candidate_policy).toBe("popularity");
		expect(strategies.trending?.weights.popularity).toBe(0.8);
		expect(strategies.new_arrivals?.candidate_policy).toBe("freshness");
		expect(strategies.new_arrivals?.weights.freshness).toBe(0.7);
		expect(strategies.similar_items?.candidate_policy).toBe(
			"vector_similarity",
		);
		expect(strategies.similar_items?.weights.similarity).toBe(0.6);
		expect(strategies.similar_items?.weights.popularity).toBe(0.2);
		expect(strategies.because_viewed?.candidate_policy).toBe(
			"vector_similarity",
		);
		expect(strategies.because_viewed?.weights.similarity).toBe(0.55);
		expect(strategies.because_viewed?.weights.category).toBe(0.12);
	});

	it("ships the two Phase-3 co-occurrence strategies with the backend's weights", () => {
		const strategies = DEFAULT_RANKING_CONFIG.strategies ?? {};
		expect(strategies.also_bought).toEqual({
			label: "Customers who bought this also bought",
			candidate_policy: "co_occurrence",
			weights: {
				popularity: 0.15,
				category: 0.05,
				tag: 0.04,
				brand: 0.03,
				freshness: 0.03,
				repetition_penalty: 0.25,
				similarity: 0,
				cooccurrence: 0.7,
			},
			// null (not 3) ⇒ keeps all neighbours; mirrors the bundle JSON.
			co_occurrence_top_k: null,
		});
		// also_bought keeps all neighbours (no top_k cut).
		expect(strategies.also_bought?.co_occurrence_top_k).toBeNull();
		expect(strategies.frequently_bought_together).toEqual({
			label: "Frequently bought together",
			candidate_policy: "co_occurrence",
			weights: {
				popularity: 0.08,
				category: 0.04,
				tag: 0.03,
				brand: 0.02,
				freshness: 0.02,
				repetition_penalty: 0.25,
				similarity: 0,
				cooccurrence: 0.8,
			},
			co_occurrence_top_k: 3,
		});
	});
});

describe("parseRankingConfig", () => {
	it("parses the committed bundle's ranking_config.json", async () => {
		const bytes = await syncedRankingConfigBytes();
		expect(parseRankingConfig(bytes)).toEqual(DEFAULT_RANKING_CONFIG);
	});

	it("falls back to the default when the file is absent (older bundle)", () => {
		expect(parseRankingConfig(undefined)).toEqual(DEFAULT_RANKING_CONFIG);
	});

	it("parses a v1 bundle (no strategies) into a graceful-degrade config", () => {
		// A schema_version 1 bundle predates the strategy map. It must parse cleanly
		// with strategies undefined, so the app degrades to the single for_you rail.
		const v1 = {
			scoring_weights: DEFAULT_RANKING_CONFIG.scoring_weights,
			interaction_weights: DEFAULT_RANKING_CONFIG.interaction_weights,
			schema_version: 1,
		};
		const bytes = new TextEncoder().encode(JSON.stringify(v1));
		const parsed = parseRankingConfig(bytes);
		expect(parsed.schema_version).toBe(1);
		expect(parsed.strategies).toBeUndefined();
	});
});

/**
 * A corrupt-but-signed ranking_config.json must fail CLOSED, not silently produce
 * NaN scores that diverge from the Python tier. These cases mirror the Pydantic
 * model's fail-closed validation: a missing/typo'd field, a non-number weight, or
 * a non-finite number must THROW — never fall back to the default (absent ≠
 * malformed; only an absent file degrades).
 */
describe("parseRankingConfig fail-closed validation", () => {
	function encode(value: unknown): Uint8Array {
		return new TextEncoder().encode(JSON.stringify(value));
	}

	/** A structurally valid config we mutate per-case to isolate one defect. */
	function validConfig(): Record<string, unknown> {
		return JSON.parse(JSON.stringify(DEFAULT_RANKING_CONFIG));
	}

	it("throws on non-JSON bytes", () => {
		const bytes = new TextEncoder().encode("{not json");
		expect(() => parseRankingConfig(bytes)).toThrow();
	});

	it("throws when scoring_weights is missing a field", () => {
		const cfg = validConfig();
		const weights = { ...(cfg.scoring_weights as Record<string, unknown>) };
		delete weights.freshness;
		cfg.scoring_weights = weights;
		expect(() => parseRankingConfig(encode(cfg))).toThrow(/freshness/);
	});

	it("throws when a scoring weight is NaN (non-finite)", () => {
		const cfg = validConfig();
		// JSON has no NaN literal, so a producer bug would serialize it as null.
		(cfg.scoring_weights as Record<string, unknown>).popularity = null;
		expect(() => parseRankingConfig(encode(cfg))).toThrow();
	});

	it("throws when a scoring weight is the wrong type", () => {
		const cfg = validConfig();
		(cfg.scoring_weights as Record<string, unknown>).popularity = "0.4";
		expect(() => parseRankingConfig(encode(cfg))).toThrow();
	});

	it("throws when schema_version is absent", () => {
		const cfg = validConfig();
		delete cfg.schema_version;
		expect(() => parseRankingConfig(encode(cfg))).toThrow(/schema_version/);
	});

	it("throws when schema_version is not a number", () => {
		const cfg = validConfig();
		cfg.schema_version = "3";
		expect(() => parseRankingConfig(encode(cfg))).toThrow();
	});

	it("throws when an interaction weight signal is missing", () => {
		const cfg = validConfig();
		const interaction = {
			...(cfg.interaction_weights as Record<string, unknown>),
		};
		delete interaction.cart;
		cfg.interaction_weights = interaction;
		expect(() => parseRankingConfig(encode(cfg))).toThrow(/cart/);
	});

	it("throws when a strategy has an unknown candidate_policy", () => {
		const cfg = validConfig();
		const strategies = {
			...(cfg.strategies as Record<string, Record<string, unknown>>),
		};
		strategies.for_you = {
			...strategies.for_you,
			candidate_policy: "telepathy",
		};
		cfg.strategies = strategies;
		expect(() => parseRankingConfig(encode(cfg))).toThrow(/candidate_policy/);
	});

	it("throws when a strategy is missing its label", () => {
		const cfg = validConfig();
		const strategies = {
			...(cfg.strategies as Record<string, Record<string, unknown>>),
		};
		const broken = { ...strategies.for_you };
		delete broken.label;
		strategies.for_you = broken;
		cfg.strategies = strategies;
		expect(() => parseRankingConfig(encode(cfg))).toThrow(/label/);
	});

	it("throws when a strategy's weights are malformed", () => {
		const cfg = validConfig();
		const strategies = {
			...(cfg.strategies as Record<string, Record<string, unknown>>),
		};
		strategies.for_you = {
			...strategies.for_you,
			weights: { popularity: 0.4 },
		};
		cfg.strategies = strategies;
		expect(() => parseRankingConfig(encode(cfg))).toThrow();
	});
});
