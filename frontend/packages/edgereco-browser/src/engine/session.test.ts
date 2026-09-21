import { describe, expect, it } from "vitest";
import type { InteractionEvent, Product } from "./domain";
import { applyInteraction, buildProfile, emptyProfile } from "./session";

function product(overrides: Partial<Product> & Pick<Product, "id">): Product {
	return {
		id: overrides.id,
		title: overrides.title ?? "",
		description: "",
		category: overrides.category ?? "",
		subcategories: [],
		tags: overrides.tags ?? [],
		brand: overrides.brand ?? "",
		price: null,
		currency: "USD",
		popularity_score: overrides.popularity_score ?? 0,
		freshness_score: overrides.freshness_score ?? 0,
		image_url: "",
		url: "",
		attributes: {},
	};
}

const P1 = product({
	id: "p1",
	title: "Polo",
	category: "Clothing",
	tags: ["men", "golf"],
	brand: "Acme",
	popularity_score: 0.8,
	freshness_score: 0.5,
});
const P2 = product({
	id: "p2",
	title: "Shoe",
	category: "Shoes",
	tags: ["run"],
	brand: "Nike",
	popularity_score: 0.6,
	freshness_score: 0.2,
});

// Reference values from edge-reco reco/signals.apply_interaction.
describe("session profile (parity vs signals.apply_interaction)", () => {
	it("accumulates affinities, dedups recently_viewed, counts clicks", () => {
		let profile = emptyProfile();
		profile = applyInteraction(profile, P1, "click");
		profile = applyInteraction(profile, P2, "favorite");
		profile = applyInteraction(profile, P1, "cart");

		expect(Object.fromEntries(profile.categoryAffinity)).toEqual({
			Clothing: 0.35,
			Shoes: 0.2,
		});
		expect(profile.tagAffinity.get("men")).toBeCloseTo(0.17, 12);
		expect(profile.tagAffinity.get("golf")).toBeCloseTo(0.17, 12);
		expect(profile.tagAffinity.get("run")).toBeCloseTo(0.1, 12);
		expect(profile.brandAffinity.get("Acme")).toBeCloseTo(0.28, 12);
		expect(profile.brandAffinity.get("Nike")).toBeCloseTo(0.15, 12);
		// p1 viewed twice -> deduped, most-recent first.
		expect(profile.recentlyViewed).toEqual(["p1", "p2"]);
		expect(profile.clickCount).toBe(1);
	});

	it("caps affinities at 1.0", () => {
		let profile = emptyProfile();
		for (let i = 0; i < 20; i += 1) {
			profile = applyInteraction(profile, P1, "cart");
		}
		expect(profile.categoryAffinity.get("Clothing")).toBe(1.0);
	});

	it("buildProfile folds events, skipping unknown product ids", () => {
		const events: InteractionEvent[] = [
			{ event_type: "click", product_id: "p1", timestamp: "t0" },
			{ event_type: "favorite", product_id: "missing", timestamp: "t1" },
			{ event_type: "cart", product_id: "p2", timestamp: "t2" },
		];
		const profile = buildProfile(
			events,
			new Map([
				["p1", P1],
				["p2", P2],
			]),
		);
		expect(profile.clickCount).toBe(1);
		expect(profile.recentlyViewed).toEqual(["p2", "p1"]);
		expect(profile.categoryAffinity.get("Shoes")).toBe(0.25);
	});
});
