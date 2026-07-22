import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the data layer: these tests pin the EMIT RULES, not the engine fold.
const { sendEvent } = vi.hoisted(() => ({
	sendEvent: vi.fn((): Promise<void> => Promise.resolve()),
}));
vi.mock("../api/client", () => ({ sendEvent }));

import type { Product } from "../api/types";
import {
	__resetSignalsForTests,
	emitInteraction,
	resetSignalCaps,
} from "./emit";

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
	return {
		id,
		title: `Product ${id}`,
		description: "",
		category: "Electronics",
		subcategories: [],
		tags: ["gadget"],
		brand: "Acme",
		price: 19.99,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
		...overrides,
	};
}

beforeEach(() => {
	sendEvent.mockClear();
	sendEvent.mockImplementation(() => Promise.resolve());
	__resetSignalsForTests();
});

describe("emitInteraction rules", () => {
	it("click: emits on every press with the taste toast", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("click", p);
		const second = await emitInteraction("click", p);
		expect(first).toEqual({
			emitted: true,
			message: "Added “Product P1” to your taste",
		});
		expect(second.emitted).toBe(true);
		expect(sendEvent).toHaveBeenCalledTimes(2);
		expect(sendEvent).toHaveBeenLastCalledWith({
			event_type: "click",
			product_id: "P1",
			timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
	});

	it("favorite: once per product per session; other products unaffected", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("favorite", p);
		expect(first.emitted).toBe(true);
		expect(first.message).toContain("strong signal");
		const repeat = await emitInteraction("favorite", p);
		expect(repeat).toEqual({ emitted: false, message: null });
		const other = await emitInteraction("favorite", makeProduct("P2"));
		expect(other.emitted).toBe(true);
		expect(sendEvent).toHaveBeenCalledTimes(2);
	});

	it("favorite: a failed send does not consume the once-per-session budget", async () => {
		const p = makeProduct("P1");
		sendEvent.mockImplementationOnce(() => Promise.reject(new Error("boom")));
		await expect(emitInteraction("favorite", p)).rejects.toThrow("boom");
		const retry = await emitInteraction("favorite", p);
		expect(retry.emitted).toBe(true);
	});

	it("cart: emits every press; honesty note only on the session's first add", async () => {
		const first = await emitInteraction("cart", makeProduct("P1"));
		const second = await emitInteraction("cart", makeProduct("P1"));
		expect(first.message).toContain("nothing is purchased");
		expect(second.emitted).toBe(true);
		expect(second.message).toContain("strong signal");
		expect(second.message).not.toContain("nothing is purchased");
		expect(sendEvent).toHaveBeenCalledTimes(2);
	});

	it("view: once per product per session, always silent", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("view", p);
		const repeat = await emitInteraction("view", p);
		expect(first).toEqual({ emitted: true, message: null });
		expect(repeat).toEqual({ emitted: false, message: null });
		expect(sendEvent).toHaveBeenCalledTimes(1);
	});

	it("resetSignalCaps re-arms the once-per-session budgets (the Reset-taste path)", async () => {
		const p = makeProduct("P1");
		await emitInteraction("favorite", p);
		await emitInteraction("view", p);
		expect((await emitInteraction("favorite", p)).emitted).toBe(false);

		resetSignalCaps();

		// After a taste reset the same product can signal again — the caps
		// share the (now cleared) profile's lifetime, not the tab's.
		expect((await emitInteraction("favorite", p)).emitted).toBe(true);
		expect((await emitInteraction("view", p)).emitted).toBe(true);
	});
});
