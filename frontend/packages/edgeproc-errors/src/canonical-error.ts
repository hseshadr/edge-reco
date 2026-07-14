import type { Category, ErrorCode, Params } from "./types.js";

/**
 * An `Error` subclass carrying a canonical `{ code, params, category }`. Use it
 * at throw-sites that already know the cause (e.g. an OPFS store on
 * `QuotaExceededError`, a device-capability guard). The `message` is the code
 * itself, so it stays greppable and stable in logs. For the ergonomic,
 * category-aware path, prefer `registry.create(code, params)`.
 */
export class CanonicalError extends Error {
  readonly code: ErrorCode;
  readonly category: Category;
  readonly params: Params;

  constructor(code: ErrorCode, category: Category, params?: Params) {
    super(code);
    this.name = "CanonicalError";
    this.code = code;
    this.category = category;
    this.params = params ?? {};
  }
}

/**
 * Thrown by `defineErrors` when the same code appears in more than one catalog
 * fragment. Codes are stable identities; a silent override would let two
 * meanings share one code.
 */
export class DuplicateCodeError extends Error {
  constructor(code: string) {
    super(
      `Duplicate error code: "${code}" is defined in more than one catalog fragment.`,
    );
    this.name = "DuplicateCodeError";
  }
}
