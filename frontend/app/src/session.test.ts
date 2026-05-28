import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getSessionId } from "./session";

const SESSION_KEY = "nimbus_session_id";

describe("getSessionId", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
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
});
