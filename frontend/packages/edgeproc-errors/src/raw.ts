/**
 * Duck-typing helpers for reading a raw failure of unknown shape. A raw failure
 * might be a thrown `Error`, a fetch `TypeError`, a provider response object, or
 * a plain string — so we probe defensively and never assume a class.
 *
 * These are exported so authors can reuse them inside their own `match` rules.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** The numeric HTTP status on a raw failure, or `undefined`. */
export function httpStatusOf(raw: unknown): number | undefined {
  if (!isRecord(raw)) return undefined;
  const status = raw.status;
  return typeof status === "number" ? status : undefined;
}

/** The `.name` of a raw failure (e.g. "AbortError"), or `""`. */
export function errorNameOf(raw: unknown): string {
  if (!isRecord(raw)) return "";
  const name = raw.name;
  return typeof name === "string" ? name : "";
}

/** The searchable text of a raw failure — its `.message` and `.body` joined. */
export function errorTextOf(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!isRecord(raw)) return "";
  const parts: string[] = [];
  const message = raw.message;
  const body = raw.body;
  if (typeof message === "string") parts.push(message);
  if (typeof body === "string") parts.push(body);
  return parts.join(" ");
}
