import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Product, SearchResult } from "../api/types";
import { RailRow } from "./RailRow";

function makeProduct(id: string, title: string, brand = "BrandX"): Product {
	return {
		id,
		title,
		description: "",
		category: "Cat",
		subcategories: [],
		tags: [],
		brand,
		price: 10,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
	};
}

function makeResult(id: string, title: string, brand?: string): SearchResult {
	return {
		product: makeProduct(id, title, brand),
		score: 0.9,
		score_components: null,
	};
}

afterEach(cleanup);

describe("RailRow", () => {
	it("renders a single card when two results share a title (app-layer dedup)", () => {
		// The catalog has distinct-ASIN, identical-title rows; a rail must never show
		// two visually-identical cards. Dedup happens at the app render layer only.
		const { container } = render(
			<RailRow
				railId="trending"
				label="Trending now"
				results={[makeResult("A1", "Aero Mug"), makeResult("A2", "Aero Mug")]}
				onPick={() => {}}
			/>,
		);
		expect(container.querySelectorAll(".rail-card")).toHaveLength(1);
	});

	it("keeps distinct-title results (no over-dedup)", () => {
		const { container } = render(
			<RailRow
				railId="trending"
				label="Trending now"
				results={[
					makeResult("A1", "Aero Mug"),
					makeResult("A2", "Nimbus Lamp"),
				]}
				onPick={() => {}}
			/>,
		);
		expect(container.querySelectorAll(".rail-card")).toHaveLength(2);
	});

	it("dedupes identical titles even when brands differ", () => {
		// One real dup-title group carries two different brands; since the card shows
		// only the title, those cards are still visually identical -> dedup by title.
		const { container } = render(
			<RailRow
				railId="trending"
				label="Trending now"
				results={[
					makeResult("A1", "Aero Mug", "Homemo"),
					makeResult("A2", "Aero Mug", "Coliary"),
				]}
				onPick={() => {}}
			/>,
		);
		expect(container.querySelectorAll(".rail-card")).toHaveLength(1);
	});

	it("derives distinct heading ids from railId even when labels collide", () => {
		// Two rails sharing a display label must NOT emit duplicate DOM ids — the id
		// is derived from the stable rail key, not the human label.
		render(
			<>
				<RailRow
					railId="trending"
					label="Recommended"
					results={[makeResult("A1", "Alpha")]}
					onPick={() => {}}
				/>
				<RailRow
					railId="for_you"
					label="Recommended"
					results={[makeResult("B1", "Beta")]}
					onPick={() => {}}
				/>
			</>,
		);
		const headings = screen.getAllByRole("heading", { level: 2 });
		expect(headings).toHaveLength(2);
		const ids = headings.map((h) => h.id);
		expect(new Set(ids).size).toBe(2);
		expect(ids.every((id) => id.length > 0)).toBe(true);
	});
});
