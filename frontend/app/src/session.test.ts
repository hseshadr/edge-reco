import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSessionId } from "./session";

const SESSION_KEY = "nimbus_session_id";
const storedValues = new Map<string, string>();

describe("getSessionId", () => {
	beforeEach(() => {
		storedValues.clear();
		vi.stubGlobal("localStorage", {
			getItem: (key: string) => storedValues.get(key) ?? null,
			setItem: (key: string, value: string) => storedValues.set(key, value),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("returns a stable value across calls", () => {
		const first = getSessionId();
		const second = getSessionId();
		expect(first).toBe(second);
	});

	it("persists the id to localStorage under the nimbus key", () => {
		const id = getSessionId();
		expect(localStorage.getItem(SESSION_KEY)).toBe(id);
	});

	it("reuses an existing id from localStorage", () => {
		localStorage.setItem(SESSION_KEY, "preexisting-id");
		expect(getSessionId()).toBe("preexisting-id");
	});

	it("generates a non-empty id when none exists", () => {
		const id = getSessionId();
		expect(id.length).toBeGreaterThan(0);
	});

	it("uses Web Crypto when randomUUID is unavailable", () => {
		const getRandomValues = vi.fn((bytes: Uint8Array): Uint8Array => {
			bytes.set(Array.from({ length: 16 }, (_, index) => index));
			return bytes;
		});
		vi.stubGlobal("crypto", { getRandomValues });

		expect(getSessionId()).toBe("nimbus-000102030405060708090a0b0c0d0e0f");
		expect(getRandomValues).toHaveBeenCalledOnce();
	});
});
