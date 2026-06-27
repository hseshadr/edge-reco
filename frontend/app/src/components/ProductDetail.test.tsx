import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, SearchResult } from "../api/types";
import { type PdpRail, ProductDetail } from "./ProductDetail";

function makeProduct(overrides: Partial<Product> = {}): Product {
	return {
		id: "P1",
		title: "Walnut Desk Organizer",
		description: "Keeps the desk tidy.",
		category: "Office Products",
		subcategories: [],
		tags: [],
		brand: "Acme",
		price: 24.5,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
		...overrides,
	};
}

function makeResult(id: string, title: string): SearchResult {
	return {
		product: makeProduct({ id, title }),
		score: 0.9,
		score_components: null,
	};
}

afterEach(cleanup);

describe("ProductDetail", () => {
	it("renders the hero with title, brand, price, description and category", () => {
		render(
			<ProductDetail
				product={makeProduct()}
				rails={[]}
				onBack={vi.fn()}
				onPick={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("heading", { level: 1, name: "Walnut Desk Organizer" }),
		).toBeInTheDocument();
		expect(screen.getByText("Acme")).toBeInTheDocument();
		expect(screen.getByText("$24.50")).toBeInTheDocument();
		expect(screen.getByText("Keeps the desk tidy.")).toBeInTheDocument();
		expect(screen.getByText("Office Products")).toBeInTheDocument();
	});

	it("omits the brand and description when they are blank", () => {
		render(
			<ProductDetail
				product={makeProduct({ brand: "  ", description: "" })}
				rails={[]}
				onBack={vi.fn()}
				onPick={vi.fn()}
			/>,
		);
		expect(screen.queryByText("Keeps the desk tidy.")).not.toBeInTheDocument();
		// Only the title heading remains; no brand chip.
		expect(screen.queryByText("Acme")).not.toBeInTheDocument();
	});

	it("invokes onBack when Back to browse is clicked", async () => {
		const onBack = vi.fn();
		render(
			<ProductDetail
				product={makeProduct()}
				rails={[]}
				onBack={onBack}
				onPick={vi.fn()}
			/>,
		);
		await userEvent.click(
			screen.getByRole("button", { name: /Back to browse/i }),
		);
		expect(onBack).toHaveBeenCalledOnce();
	});

	it("renders only the rails that have results (empty rails are dropped)", () => {
		const rails: PdpRail[] = [
			{
				key: "similar_items",
				label: "Similar items",
				results: [makeResult("S1", "Sibling")],
			},
			{ key: "also_bought", label: "Customers also bought", results: [] },
		];
		render(
			<ProductDetail
				product={makeProduct()}
				rails={rails}
				onBack={vi.fn()}
				onPick={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Similar items" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Customers also bought" }),
		).not.toBeInTheDocument();
	});
});
