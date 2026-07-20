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

	it("renders the baked-in local /images/<id>.svg as a real image, not the tile", () => {
		// The signed bundle rewrites each product's image_url to the root-relative
		// local asset the app ships in public/images. This is the branch that would
		// have caught the shipped-placeholders regression: a real <img>, not a tile.
		render(
			<ProductImage
				product={{ ...product, image_url: `/images/${product.id}.svg` }}
			/>,
		);

		expect(screen.getByRole("img", { name: product.title })).toHaveAttribute(
			"src",
			`/images/${product.id}.svg`,
		);
		expect(screen.queryByText("Sports")).not.toBeInTheDocument();
	});
});
