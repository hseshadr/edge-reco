/**
 * The public type surface for @edgeproc/errors.
 *
 * A canonical error is `{ code, params, category }` and serializes to the
 * RFC 9457 Problem Details shape on the wire. The catalog entry for a code is
 * the typed contract for that error's params.
 */

// Type-only (erased) import to type `Registry.create`'s return value.
import type { CanonicalError } from "./canonical-error.js";

/** A stable, namespaced error identity, e.g. `ai.provider.out_of_credits`. */
export type ErrorCode = string;

/**
 * How a failure should be treated by UI + telemetry: retry vs. "open Settings"
 * vs. "free up space", etc.
 */
export type Category =
  | "provider"
  | "config"
  | "network"
  | "timeout"
  | "device"
  | "integrity"
  | "internal";

/** A value that may be interpolated into an error description. */
export type ParamValue = string | number;

/** A bag of interpolation values, keyed by param name. */
export type Params = Readonly<Record<string, ParamValue>>;

/**
 * A consumer-provided i18next-style translate function. Deliberately minimal so
 * i18next stays an OPTIONAL peer dependency: we call `t("errors.<code>", values)`
 * and rely on i18next's contract of returning the key verbatim when it is
 * missing, which is our signal to fall back to the catalog default English.
 */
export type TFunction = (
  key: string,
  params?: Record<string, ParamValue>,
) => string;

/** A predicate that inspects a raw failure and claims it for a code. */
export type MatchRule = (raw: unknown) => boolean;

/** One code's typed contract: its category, allowed params, and match rules. */
export interface CatalogEntry {
  /** UI/telemetry treatment bucket. */
  readonly category: Category;
  /** The interpolation params this code's description may use. */
  readonly params?: readonly string[];
  /** Override the i18n key (defaults to `errors.<code>`). */
  readonly i18nKey?: string;
  /** HTTP statuses that `classify` maps to this code. */
  readonly httpStatus?: readonly number[];
  /** Problem Details `type` URI (defaults to the code itself). */
  readonly problemType?: string;
  /** Default English — the fallback when i18n has no localized string. */
  readonly en?: string;
  /** A custom `classify` predicate; wins over `httpStatus`. */
  readonly match?: MatchRule;
}

/** A map of code -> entry. Each site declares and owns its own. */
export type Catalog = Readonly<Record<string, CatalogEntry>>;

/** The param names declared by an entry, as a string-literal union. */
type ParamNamesOf<E> = E extends { readonly params: readonly (infer P)[] }
  ? P extends string
    ? P
    : never
  : never;

/**
 * The typed params object for code `K` in catalog `C`: only the params the
 * entry declared, each optional (a missing param renders its placeholder-free
 * fallback). Codes with no declared params accept any/none.
 */
export type ParamsFor<C extends Catalog, K extends keyof C> = [
  ParamNamesOf<C[K]>,
] extends [never]
  ? Params | undefined
  : Partial<Record<ParamNamesOf<C[K]>, ParamValue>>;

/** RFC 9457 Problem Details. Extension members are spread in as `params`. */
export interface ProblemDetails {
  /** A URI (or the code) identifying the problem type. */
  type: string;
  /** A short, human-readable summary. */
  title: string;
  /** The HTTP status code, when known. */
  status?: number;
  /** A URI reference identifying the specific occurrence. */
  instance?: string;
  /** A human-readable explanation specific to this occurrence. */
  detail?: string;
  /** Extension members (the error's params). */
  [member: string]: ParamValue | undefined;
}

/** Options for {@link Registry.toProblemDetails}. */
export interface ProblemOptions {
  readonly status?: number;
  readonly title?: string;
  readonly instance?: string;
}

/**
 * A per-app error registry: the one place a site classifies raw failures into
 * its codes, describes them via its own i18n, and serializes them for the wire.
 */
export interface Registry<C extends Catalog = Catalog> {
  /** Every registered code, in registration order. */
  readonly codes: readonly string[];
  /** Whether a code is registered. */
  has(code: string): boolean;
  /** The entry for a code, or `undefined`. */
  get(code: string): CatalogEntry | undefined;
  /** Turn a raw transport/LLM failure into a code (fallback `internal.unknown`). */
  classify(raw: unknown): ErrorCode;

  /** Resolve the human text for a code via i18n, falling back to English. */
  describe<K extends keyof C & string>(
    code: K,
    params?: ParamsFor<C, K>,
    t?: TFunction,
  ): string;
  describe(code: ErrorCode, params?: Params, t?: TFunction): string;

  /** Serialize a code to the RFC 9457 Problem Details shape. */
  toProblemDetails<K extends keyof C & string>(
    code: K,
    params?: ParamsFor<C, K>,
    options?: ProblemOptions,
  ): ProblemDetails;
  toProblemDetails(
    code: ErrorCode,
    params?: Params,
    options?: ProblemOptions,
  ): ProblemDetails;

  /** Construct a {@link CanonicalError}, looking the category up from the catalog. */
  create<K extends keyof C & string>(
    code: K,
    params?: ParamsFor<C, K>,
  ): CanonicalError;
  create(code: ErrorCode, params?: Params): CanonicalError;
}
