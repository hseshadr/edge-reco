// Ranking configuration carried in the signed bundle as `ranking_config.json`,
// the in-browser mirror of edge-reco's reco/ranking_config.py. The weights used
// to be hardcoded TS constants; they now ride INSIDE the signed, content-
// addressed bundle, so a maintainer retunes ranking by republishing data — no
// code change. `parseRankingConfig` reads the file off the VERIFIED sync path
// (runtime.ts), and `DEFAULT_RANKING_CONFIG` reproduces today's exact values as
// the typed fallback when a bundle predates the file, so scores stay identical.
//
// Keys are snake_case to match the JSON the Python producer writes byte-for-byte.

/**
 * Per-signal weights for the final ranking formula (scorer.score_product).
 *
 * `similarity` is the Phase-2 addition (cosine to a seed product). The Python
 * producer always serializes it (Pydantic emits its 0.0 default), so the bundle
 * carries `similarity: 0` on every weights object; we mirror that here so the
 * parsed config equals the default byte-for-byte. It is 0 for every non-
 * `vector_similarity` strategy, so their formula reduces to the original.
 */
export interface ScoringWeights {
	readonly popularity: number;
	readonly category: number;
	readonly tag: number;
	readonly brand: number;
	readonly freshness: number;
	readonly repetition_penalty: number;
	readonly similarity: number;
	/**
	 * Phase-3 weight on a candidate's co-occurrence score to a seed product
	 * ("customers also bought"). 0 for every non-`co_occurrence` strategy, so the
	 * formula reduces to Phase-2 byte-for-byte. The Python producer serializes it
	 * on every weights object (Pydantic emits its 0.0 default), so we mirror it.
	 */
	readonly cooccurrence: number;
}

/** Affinity bumps a single interaction applies (signals.apply_interaction). */
export interface GradedSignal {
	readonly category: number;
	readonly tag: number;
	readonly brand: number;
}

/** Per-event-type affinity bumps, one GradedSignal per EventType. */
export interface InteractionWeights {
	readonly click: GradedSignal;
	readonly view: GradedSignal;
	readonly favorite: GradedSignal;
	readonly cart: GradedSignal;
}

/**
 * Closed set of candidate-selection policies a strategy may pick (poolSelection).
 * `affinity_first` is today's warm/cold logic; the others are Phase-2 additions.
 */
export type CandidatePolicy =
	| "affinity_first"
	| "popularity"
	| "freshness"
	| "vector_similarity"
	| "co_occurrence";

/**
 * A named recommendation strategy: a candidate policy + its scoring weights.
 * Carried in the bundle so a maintainer can add or retune a rail by republishing
 * data — no code change. `label` is the human-facing rail title.
 */
export interface Strategy {
	readonly label: string;
	readonly candidate_policy: CandidatePolicy;
	readonly weights: ScoringWeights;
	/**
	 * Phase-3: caps how many of the seed's co-occurrence neighbours feed the pool.
	 * `null`/undefined keeps them all (`also_bought`); a small integer makes a
	 * tighter "frequently bought together" cut. Only read by the `co_occurrence`
	 * policy. The Python producer serializes it on EVERY strategy (Pydantic emits
	 * its `None` default as JSON `null`), so the default config mirrors that to
	 * stay byte-for-byte equal to the synced bundle's ranking_config.json.
	 */
	readonly co_occurrence_top_k?: number | null;
}

/**
 * The full ranking configuration carried as `ranking_config.json`.
 *
 * `strategies` is the Phase-2 addition (schema_version 2); it defaults to empty so
 * a v1 bundle loads cleanly and only `for_you` (the top-level weights) applies.
 */
export interface RankingConfig {
	readonly scoring_weights: ScoringWeights;
	readonly interaction_weights: InteractionWeights;
	readonly schema_version: number;
	readonly strategies?: Record<string, Strategy>;
}

/** The `for_you`/default weights — today's formula, byte-for-byte. */
const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
	popularity: 0.4,
	category: 0.2,
	tag: 0.15,
	brand: 0.1,
	freshness: 0.1,
	repetition_penalty: 0.25,
	similarity: 0,
	cooccurrence: 0,
};

/**
 * The five shipped strategies, mirroring reco/ranking_config.py exactly.
 * `for_you` reuses the top-level weights verbatim (Phase-1 parity); the others
 * lean their dominant signal heaviest. `similarity` is non-zero only for the
 * vector-similarity strategies.
 */
const DEFAULT_STRATEGIES: Record<string, Strategy> = {
	for_you: {
		label: "Recommended for you",
		candidate_policy: "affinity_first",
		weights: DEFAULT_SCORING_WEIGHTS,
		co_occurrence_top_k: null,
	},
	trending: {
		label: "Trending now",
		candidate_policy: "popularity",
		weights: {
			popularity: 0.8,
			category: 0.05,
			tag: 0.04,
			brand: 0.03,
			freshness: 0.08,
			repetition_penalty: 0.25,
			similarity: 0,
			cooccurrence: 0,
		},
		co_occurrence_top_k: null,
	},
	new_arrivals: {
		label: "New arrivals",
		candidate_policy: "freshness",
		weights: {
			popularity: 0.15,
			category: 0.05,
			tag: 0.04,
			brand: 0.03,
			freshness: 0.7,
			repetition_penalty: 0.25,
			similarity: 0,
			cooccurrence: 0,
		},
		co_occurrence_top_k: null,
	},
	similar_items: {
		label: "Similar items",
		candidate_policy: "vector_similarity",
		weights: {
			popularity: 0.2,
			category: 0.05,
			tag: 0.04,
			brand: 0.03,
			freshness: 0.05,
			repetition_penalty: 0.25,
			similarity: 0.6,
			cooccurrence: 0,
		},
		co_occurrence_top_k: null,
	},
	because_viewed: {
		label: "Because you viewed this",
		candidate_policy: "vector_similarity",
		weights: {
			popularity: 0.1,
			category: 0.12,
			tag: 0.08,
			brand: 0.06,
			freshness: 0.04,
			repetition_penalty: 0.25,
			similarity: 0.55,
			cooccurrence: 0,
		},
		co_occurrence_top_k: null,
	},
	also_bought: {
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
		co_occurrence_top_k: null,
	},
	frequently_bought_together: {
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
	},
};

/**
 * Today's weights + the Phase-2 strategy map, byte-for-byte. The typed fallback
 * when a synced bundle predates `ranking_config.json` — keeps `for_you` scores
 * identical to the constants the scorer used before the config moved into the
 * bundle. The committed seed bundle ships an equal config.
 */
export const DEFAULT_RANKING_CONFIG: RankingConfig = {
	scoring_weights: DEFAULT_SCORING_WEIGHTS,
	interaction_weights: {
		click: { category: 0.1, tag: 0.05, brand: 0.08 },
		view: { category: 0.02, tag: 0.01, brand: 0.02 },
		favorite: { category: 0.2, tag: 0.1, brand: 0.15 },
		cart: { category: 0.25, tag: 0.12, brand: 0.2 },
	},
	schema_version: 3,
	strategies: DEFAULT_STRATEGIES,
};

const DECODER = new TextDecoder();

/** The closed set of candidate policies, as a runtime guard set (mirrors the type). */
const CANDIDATE_POLICIES: ReadonlySet<string> = new Set<CandidatePolicy>([
	"affinity_first",
	"popularity",
	"freshness",
	"vector_similarity",
	"co_occurrence",
]);

const SCORING_WEIGHT_FIELDS = [
	"popularity",
	"category",
	"tag",
	"brand",
	"freshness",
	"repetition_penalty",
	"similarity",
	"cooccurrence",
] as const;

const GRADED_SIGNAL_FIELDS = ["category", "tag", "brand"] as const;
const INTERACTION_FIELDS = ["click", "view", "favorite", "cart"] as const;

/**
 * Thrown when a present-but-malformed `ranking_config.json` fails validation. The
 * browser tier fails CLOSED here so a corrupt-but-signed bundle surfaces loudly
 * instead of feeding NaN into the scorer and diverging from the Python tier.
 */
export class RankingConfigError extends Error {
	public constructor(message: string) {
		super(`malformed ranking_config.json: ${message}`);
		this.name = "RankingConfigError";
	}
}

function asRecord(value: unknown, at: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new RankingConfigError(`${at} must be an object`);
	}
	return value as Record<string, unknown>;
}

/** A finite number — rejects strings, null, NaN and ±Infinity (the NaN-score guard). */
function assertFiniteNumber(value: unknown, at: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new RankingConfigError(`${at} must be a finite number`);
	}
	return value;
}

function assertString(value: unknown, at: string): string {
	if (typeof value !== "string") {
		throw new RankingConfigError(`${at} must be a string`);
	}
	return value;
}

function assertScoringWeights(value: unknown, at: string): ScoringWeights {
	const record = asRecord(value, at);
	for (const field of SCORING_WEIGHT_FIELDS) {
		assertFiniteNumber(record[field], `${at}.${field}`);
	}
	return value as ScoringWeights;
}

function assertGradedSignal(value: unknown, at: string): void {
	const record = asRecord(value, at);
	for (const field of GRADED_SIGNAL_FIELDS) {
		assertFiniteNumber(record[field], `${at}.${field}`);
	}
}

function assertInteractionWeights(value: unknown, at: string): void {
	const record = asRecord(value, at);
	for (const field of INTERACTION_FIELDS) {
		assertGradedSignal(record[field], `${at}.${field}`);
	}
}

function assertCandidatePolicy(value: unknown, at: string): void {
	if (typeof value !== "string" || !CANDIDATE_POLICIES.has(value)) {
		throw new RankingConfigError(
			`${at}.candidate_policy is not a known policy`,
		);
	}
}

function assertStrategy(value: unknown, at: string): void {
	const record = asRecord(value, at);
	assertString(record.label, `${at}.label`);
	assertCandidatePolicy(record.candidate_policy, at);
	assertScoringWeights(record.weights, `${at}.weights`);
	const topK = record.co_occurrence_top_k;
	if (topK !== undefined && topK !== null) {
		assertFiniteNumber(topK, `${at}.co_occurrence_top_k`);
	}
}

function assertStrategies(value: unknown): void {
	const record = asRecord(value, "strategies");
	for (const [key, strategy] of Object.entries(record)) {
		assertStrategy(strategy, `strategies.${key}`);
	}
}

/**
 * Runtime-validate parsed JSON into a RankingConfig, mirroring the Python Pydantic
 * model field-for-field. Throws RankingConfigError on any shape/type mismatch so a
 * corrupt-but-signed bundle fails closed rather than producing NaN scores.
 */
function assertRankingConfig(value: unknown): RankingConfig {
	const record = asRecord(value, "ranking_config");
	assertScoringWeights(record.scoring_weights, "scoring_weights");
	assertInteractionWeights(record.interaction_weights, "interaction_weights");
	assertFiniteNumber(record.schema_version, "schema_version");
	if (record.strategies !== undefined) {
		assertStrategies(record.strategies);
	}
	return value as RankingConfig;
}

/**
 * Parse the verified `ranking_config.json` bytes into a RankingConfig. The bytes
 * arrive ALREADY ed25519/sha256-verified as part of the signed bundle (the
 * runtime reads them through the same materialize path as catalog_meta.json).
 * `undefined` means an older bundle that predates the file → typed default.
 *
 * Present-but-malformed bytes FAIL CLOSED: validation mirrors the Python Pydantic
 * model, and any shape/type mismatch (missing field, wrong type, non-finite
 * number, unknown candidate_policy) throws — it never silently falls back, so a
 * corrupt-but-signed bundle can't quietly diverge from the Python tier.
 */
export function parseRankingConfig(
	bytes: Uint8Array | undefined,
): RankingConfig {
	if (bytes === undefined) {
		return DEFAULT_RANKING_CONFIG;
	}
	return assertRankingConfig(JSON.parse(DECODER.decode(bytes)));
}
