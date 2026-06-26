import { describe, expect, it } from "vitest";
import { canonicalBytes, type JsonValue } from "./canonical";

const DECODER = new TextDecoder();

describe("canonicalBytes", () => {
	it("produces identical bytes regardless of key insertion order", () => {
		const a: JsonValue = {
			manifest_hash: "abc",
			version: "v1",
			signature: "sig",
		};
		const b: JsonValue = {
			signature: "sig",
			version: "v1",
			manifest_hash: "abc",
		};
		expect(canonicalBytes(a)).toEqual(canonicalBytes(b));
	});

	it("sorts keys recursively but preserves list order", () => {
		const obj: JsonValue = {
			files: [
				{ path: "z", chunks: [{ size: 2, hash: "b" }] },
				{ path: "a", chunks: [{ hash: "c", size: 1 }] },
			],
			bundle_id: "x",
		};
		const text = DECODER.decode(canonicalBytes(obj));
		// keys sorted: bundle_id before files; chunks fields sorted hash<size;
		// but the two files keep their array order (z then a).
		expect(text).toBe(
			'{"bundle_id":"x","files":[{"chunks":[{"hash":"b","size":2}],"path":"z"},{"chunks":[{"hash":"c","size":1}],"path":"a"}]}',
		);
	});

	it("emits no whitespace and uses , / : separators", () => {
		const text = DECODER.decode(canonicalBytes({ b: 1, a: 2 }));
		expect(text).toBe('{"a":2,"b":1}');
	});

	it("emits non-ASCII raw as UTF-8 (ensure_ascii=False parity)", () => {
		const bytes = canonicalBytes({ title: "café — naïve" });
		// raw UTF-8, not \u escapes
		expect(DECODER.decode(bytes)).toBe('{"title":"café — naïve"}');
		expect(bytes).toEqual(new TextEncoder().encode('{"title":"café — naïve"}'));
	});

	it("excludes named top-level keys (signature exclusion)", () => {
		const pointer: JsonValue = {
			manifest_hash: "h",
			version: "v1",
			signature: "SIG",
		};
		const text = DECODER.decode(
			canonicalBytes(pointer, { exclude: { signature: true } }),
		);
		expect(text).toBe('{"manifest_hash":"h","version":"v1"}');
	});

	it("building the same object two ways yields identical bytes", () => {
		const built: Record<string, JsonValue> = {};
		built.signature = "SIG";
		built.version = "v1";
		built.manifest_hash = "h";
		const literal: JsonValue = {
			manifest_hash: "h",
			version: "v1",
			signature: "SIG",
		};
		expect(canonicalBytes(built)).toEqual(canonicalBytes(literal));
	});
});
