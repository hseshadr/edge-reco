// Deterministic JSON byte-encoding that BYTE-MATCHES Python's
// edgeproc.bundles.manifest.canonical_bytes:
//
//   json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
//   .encode("utf-8")
//
// i.e. dict keys sorted recursively, list order preserved, separators ","/":"
// with NO whitespace, non-ASCII emitted raw (UTF-8, not \uXXXX). The pointer
// signature is over these exact bytes — a mismatch means it will not verify.

/** A JSON value: the shape `model_dump(mode="json")` produces. */
export type JsonValue =
	| string
	| number
	| boolean
	| null
	| ReadonlyArray<JsonValue>
	| { readonly [key: string]: JsonValue };

interface CanonicalOptions {
	/** Top-level keys to drop (mirrors Python `exclude=`), e.g. `{ signature: true }`. */
	readonly exclude?: Readonly<Record<string, true>>;
}

function isPlainObject(
	value: JsonValue,
): value is { readonly [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Serialize a value with recursively sorted object keys and no whitespace.
 *
 * `JSON.stringify` already uses `,`/`:` separators and emits non-ASCII raw
 * (matching `ensure_ascii=False`); supplying our own key ordering is the only
 * thing it lacks. We sort with the default `<` on UTF-16 code units, which
 * matches Python's `sorted()` on the ASCII keys used by the manifest schema.
 */
function serialize(value: JsonValue): string {
	if (Array.isArray(value)) {
		return `[${value.map(serialize).join(",")}]`;
	}
	if (isPlainObject(value)) {
		const keys = Object.keys(value).sort();
		const members = keys.map(
			(key) => `${JSON.stringify(key)}:${serialize(value[key] as JsonValue)}`,
		);
		return `{${members.join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Canonical UTF-8 bytes of `obj`, dropping any top-level `exclude` keys. */
export function canonicalBytes(
	obj: JsonValue,
	options: CanonicalOptions = {},
): Uint8Array {
	let payload = obj;
	const exclude = options.exclude;
	if (exclude !== undefined && isPlainObject(obj)) {
		const filtered: Record<string, JsonValue> = {};
		for (const key of Object.keys(obj)) {
			if (exclude[key] !== true) {
				filtered[key] = obj[key] as JsonValue;
			}
		}
		payload = filtered;
	}
	return new TextEncoder().encode(serialize(payload));
}
