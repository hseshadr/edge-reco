import { describe, expect, it } from "vitest";
import { formatPrice } from "./format";

describe("formatPrice", () => {
	it("returns a graceful placeholder for a null price", () => {
		expect(formatPrice(null, "USD")).toBe("Price on request");
	});

	it("formats a USD price with the currency symbol", () => {
		expect(formatPrice(24.5, "USD")).toBe("$24.50");
	});

	it("treats a blank currency code as USD", () => {
		expect(formatPrice(10, "")).toBe("$10.00");
	});

	it("falls back to `<CODE> <amount>` for an invalid currency code", () => {
		// A non-ISO code makes Intl.NumberFormat throw; the catch path keeps the
		// price legible instead of crashing the card.
		expect(formatPrice(12, "NOTACODE")).toBe("NOTACODE 12.00");
	});
});
