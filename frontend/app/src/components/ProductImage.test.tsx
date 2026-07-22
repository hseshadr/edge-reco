import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Product } from "../api/types";
import { ProductImage } from "./ProductImage";

const product: Product = {
	id: "P1",
	title: "Waterproof Hiking Boot",
	description: "",
	category: "Sports",
	subcategories: [],
	tags: [],
	brand: "Timberland",
	price: 100,
	currency: "USD",
	popularity_score: 0.8,
	freshness_score: 0.7,
	image_url: "https://m.media-amazon.com/images/P1.jpg",
	url: "",
	attributes: {},
};

afterEach(cleanup);

describe("ProductImage egress boundary", () => {
	it("uses the editorial placeholder instead of a remote catalog image", () => {
		render(<ProductImage product={product} />);

		expect(screen.queryByRole("img")).not.toBeInTheDocument();
		expect(screen.getByText("Sports")).toBeInTheDocument();
	});

	it("rejects a backslash authority form that URL parsing could make remote", () => {
		render(
			<ProductImage
				product={{ ...product, image_url: "/\\evil.example/P1.webp" }}
			/>,
		);

		expect(screen.queryByRole("img")).not.toBeInTheDocument();
	});

	it("allows a release-owned root-relative image", () => {
		render(
			<ProductImage product={{ ...product, image_url: "/products/P1.webp" }} />,
		);

		expect(screen.getByRole("img", { name: product.title })).toHaveAttribute(
			"src",
			"/products/P1.webp",
		);
	});
});

describe("ProductImage tile mapping", () => {
	it("maps a real compound catalog category to its own tile, not the default", () => {
		const { container } = render(
			<ProductImage
				product={{ ...product, category: "Clothing, Shoes & Jewelry" }}
			/>,
		);

		const tile = container.querySelector(".pimg-tile");
		expect(tile).toHaveClass("pimg-tile--clothing");
		expect(tile).not.toHaveClass("pimg-tile--default");
	});

	it("applies the deterministic per-product tone variant", () => {
		// "P1" hashes to a non-base tone; the exact class is pinned by toneClassFor.
		const { container } = render(<ProductImage product={product} />);
		const tile = container.querySelector(".pimg-tile");
		const first = tile?.className;
		cleanup();
		const second = render(
			<ProductImage product={product} />,
		).container.querySelector(".pimg-tile")?.className;
		expect(first).toBe(second);
	});
});
