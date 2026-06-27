import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Footer } from "./Footer";

afterEach(cleanup);

describe("Footer", () => {
	it("states plainly that Nimbus is a fictional demo store", () => {
		render(<Footer />);
		expect(
			screen.getByText(/Nimbus is a fictional demo store/i),
		).toBeInTheDocument();
	});

	it("links to the edge-reco repo", () => {
		render(<Footer />);
		const link = screen.getByRole("link", { name: "edge-reco" });
		expect(link).toHaveAttribute(
			"href",
			"https://github.com/hseshadr/edge-reco",
		);
	});

	it("credits the catalog data source for attribution", () => {
		render(<Footer />);
		expect(screen.getByText(/Product data:/i)).toBeInTheDocument();
	});
});
