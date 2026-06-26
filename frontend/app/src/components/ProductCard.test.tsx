import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../api/types";
import { ProductCard } from "./ProductCard";

const product: Product = {
	id: "P1",
	title: "Walnut Desk Organizer",
	description: "",
	category: "Office Products",
	subcategories: [],
	tags: ["desk"],
	brand: "Acme",
	price: 24.5,
	currency: "USD",
	popularity_score: 0.5,
	freshness_score: 0.5,
	image_url: "",
	url: "",
	attributes: {},
};

function renderCard(overrides: { favorited?: boolean } = {}) {
	const onPick = vi.fn();
	const onFavorite = vi.fn();
	const onAddToCart = vi.fn();
	render(
		<ProductCard
			product={product}
			index={0}
			onPick={onPick}
			onFavorite={onFavorite}
			onAddToCart={onAddToCart}
			favorited={overrides.favorited ?? false}
			dwellRef={() => {}}
		/>,
	);
	return { onPick, onFavorite, onAddToCart };
}

afterEach(cleanup);

describe("ProductCard affordances", () => {
	it("full-card overlay picks the product", async () => {
		const { onPick, onFavorite, onAddToCart } = renderCard();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Add “Walnut Desk Organizer” to your taste",
			}),
		);
		expect(onPick).toHaveBeenCalledExactlyOnceWith(product);
		expect(onFavorite).not.toHaveBeenCalled();
		expect(onAddToCart).not.toHaveBeenCalled();
	});

	it("the heart favorites WITHOUT also picking (no double signal)", async () => {
		const { onPick, onFavorite } = renderCard();
		await userEvent.click(
			screen.getByRole("button", { name: "Favorite “Walnut Desk Organizer”" }),
		);
		expect(onFavorite).toHaveBeenCalledExactlyOnceWith(product);
		expect(onPick).not.toHaveBeenCalled();
	});

	it("add-to-cart fires WITHOUT also picking", async () => {
		const { onPick, onAddToCart } = renderCard();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Add “Walnut Desk Organizer” to cart",
			}),
		);
		expect(onAddToCart).toHaveBeenCalledExactlyOnceWith(product);
		expect(onPick).not.toHaveBeenCalled();
	});

	it("favorited state: aria-pressed + Unfavorite label", () => {
		renderCard({ favorited: true });
		const heart = screen.getByRole("button", {
			name: "Unfavorite “Walnut Desk Organizer”",
		});
		expect(heart).toHaveAttribute("aria-pressed", "true");
	});
});
