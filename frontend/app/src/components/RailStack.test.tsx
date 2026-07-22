import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product, SearchResult } from "../api/types";
import { type RailData, RailStack } from "./RailStack";

function makeResult(id: string, title: string): SearchResult {
	const product: Product = {
		id,
		title,
		description: "",
		category: "Cat",
		subcategories: [],
		tags: [],
		brand: "BrandX",
		price: 10,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
	};
	return { product, score: 0.9, score_components: null };
}

function rail(
	strategy: string,
	label: string,
	results: SearchResult[],
): RailData {
	return { spec: { strategy, label }, results };
}

afterEach(cleanup);

describe("RailStack", () => {
	it("renders nothing when every rail is empty", () => {
		const { container } = render(
			<RailStack
				rails={[rail("for_you", "Recommended for you", [])]}
				onPick={vi.fn()}
				onResetTaste={vi.fn()}
				personalizing={false}
				signalCount={0}
			/>,
		);
		expect(container.querySelector(".rail-stack")).toBeNull();
	});

	it("drops empty rails but keeps the populated ones", () => {
		render(
			<RailStack
				rails={[
					rail("for_you", "Recommended for you", [makeResult("A1", "Alpha")]),
					rail("trending", "Trending now", []),
				]}
				onPick={vi.fn()}
				onResetTaste={vi.fn()}
				personalizing={false}
				signalCount={0}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Recommended for you" }),
		).toBeInTheDocument();
		expect(
			screen.queryByRole("heading", { name: "Trending now" }),
		).not.toBeInTheDocument();
	});

	it("shows the session signal count only on the For-You rail", () => {
		render(
			<RailStack
				rails={[
					rail("for_you", "Recommended for you", [makeResult("A1", "Alpha")]),
					rail("trending", "Trending now", [makeResult("B1", "Beta")]),
				]}
				onPick={vi.fn()}
				onResetTaste={vi.fn()}
				personalizing={false}
				signalCount={5}
			/>,
		);
		// The clicks badge (signalCount) renders exactly once — on For You only.
		const badge = screen.getByTitle("5 signals — saved only in this browser");
		expect(badge).toHaveTextContent("5");
	});

	it("flags the For-You rail as personalizing while a re-rank is in flight", () => {
		render(
			<RailStack
				rails={[
					rail("for_you", "Recommended for you", [makeResult("A1", "Alpha")]),
				]}
				onPick={vi.fn()}
				onResetTaste={vi.fn()}
				personalizing={true}
				signalCount={0}
			/>,
		);
		expect(screen.getByText("personalizing…")).toBeInTheDocument();
	});

	it("labels a known strategy with its tagline and falls back otherwise", () => {
		render(
			<RailStack
				rails={[
					rail("trending", "Trending now", [makeResult("B1", "Beta")]),
					rail("mystery", "Mystery rail", [makeResult("C1", "Gamma")]),
				]}
				onPick={vi.fn()}
				onResetTaste={vi.fn()}
				personalizing={false}
				signalCount={0}
			/>,
		);
		expect(screen.getByText("by popularity")).toBeInTheDocument();
		expect(screen.getByText("in-tab ranking")).toBeInTheDocument();
	});
});
