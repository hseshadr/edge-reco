import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, ScoreComponents } from "../api/types";
import { RailCard } from "./RailCard";

const product: Product = {
	id: "P1",
	title: "Aero Mug",
	description: "",
	category: "Home & Kitchen",
	subcategories: [],
	tags: [],
	brand: "Homemo",
	price: 18,
	currency: "USD",
	popularity_score: 0.5,
	freshness_score: 0.5,
	image_url: "https://img.example.com/p1.jpg",
	url: "",
	attributes: {},
};

const components: ScoreComponents = {
	popularity: 0.4,
	category_match: 0.2,
	tag_match: 0.15,
	brand_match: 0.1,
	freshness: 0.1,
	similarity: 0,
	cooccurrence: 0,
	repetition_penalty: 0.25,
};

afterEach(cleanup);

describe("RailCard", () => {
	it("renders the rank, title and rounded score and picks on click", async () => {
		const onPick = vi.fn();
		render(
			<RailCard
				product={product}
				rank={3}
				score={0.876}
				components={null}
				onPick={onPick}
			/>,
		);
		expect(screen.getByText("3")).toBeInTheDocument();
		expect(screen.getByText("Aero Mug")).toBeInTheDocument();
		expect(screen.getByText("0.88")).toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: /Aero Mug/i }));
		expect(onPick).toHaveBeenCalledExactlyOnceWith(product);
	});

	it("omits the why-toggle when there is no component breakdown", () => {
		render(
			<RailCard
				product={product}
				rank={1}
				score={0.9}
				components={null}
				onPick={vi.fn()}
			/>,
		);
		expect(
			screen.queryByRole("button", { name: "why?" }),
		).not.toBeInTheDocument();
	});

	it("toggles the score breakdown popover open and closed", async () => {
		render(
			<RailCard
				product={product}
				rank={1}
				score={0.9}
				components={components}
				onPick={vi.fn()}
			/>,
		);
		const why = screen.getByRole("button", { name: "why?" });
		expect(why).toHaveAttribute("aria-expanded", "false");
		expect(screen.queryByText("Why this ranks here")).not.toBeInTheDocument();

		await userEvent.click(why);

		const hide = screen.getByRole("button", { name: "hide" });
		expect(hide).toHaveAttribute("aria-expanded", "true");
		// WhyPopover renders the labeled component breakdown.
		expect(screen.getByText("Why this ranks here")).toBeInTheDocument();
		expect(screen.getByText("Popularity")).toBeInTheDocument();
		expect(screen.getByText("Repetition penalty")).toBeInTheDocument();
		expect(screen.getByText("0.40")).toBeInTheDocument();

		await userEvent.click(hide);
		expect(screen.getByRole("button", { name: "why?" })).toHaveAttribute(
			"aria-expanded",
			"false",
		);
	});
});
