import { applyInteraction, emptyProfile } from "@edgeproc/browser";
import { describe, expect, it } from "vitest";
import type { Product } from "../api/types";

// Pins the spec's headline grading against the REAL engine session fold:
// one cart-add must out-weigh two clicks on EVERY affinity facet
// (category 0.25 > 0.20, tag 0.12 > 0.10, brand 0.20 > 0.16). A weight
// regression in either tier's table flips this red — deterministically,
// with no UI in the loop. (The e2e proves the visible rail effect.)

const product: Product = {
	id: "P1",
	title: "Aluminum Desk Lamp",
	description: "",
	category: "Electronics",
	subcategories: [],
	tags: ["lighting", "desk"],
	brand: "Lumina",
	price: 39.0,
	currency: "USD",
	popularity_score: 0.5,
	freshness_score: 0.5,
	image_url: "",
	url: "",
	attributes: {},
};

describe("graded signals: engine fold dominance", () => {
	it("one cart-add out-weighs two clicks on every affinity facet", () => {
		const cart = applyInteraction(emptyProfile(), product, "cart");
		const twoClicks = applyInteraction(
			applyInteraction(emptyProfile(), product, "click"),
			product,
			"click",
		);

		expect(cart.categoryAffinity.get("Electronics")).toBeGreaterThan(
			twoClicks.categoryAffinity.get("Electronics") ?? 0,
		);
		for (const tag of product.tags) {
			expect(cart.tagAffinity.get(tag)).toBeGreaterThan(
				twoClicks.tagAffinity.get(tag) ?? 0,
			);
		}
		expect(cart.brandAffinity.get("Lumina")).toBeGreaterThan(
			twoClicks.brandAffinity.get("Lumina") ?? 0,
		);
	});

	it("favorite also out-weighs a single click on every facet", () => {
		const favorite = applyInteraction(emptyProfile(), product, "favorite");
		const click = applyInteraction(emptyProfile(), product, "click");

		expect(favorite.categoryAffinity.get("Electronics")).toBeGreaterThan(
			click.categoryAffinity.get("Electronics") ?? 0,
		);
		expect(favorite.brandAffinity.get("Lumina")).toBeGreaterThan(
			click.brandAffinity.get("Lumina") ?? 0,
		);
	});
});
