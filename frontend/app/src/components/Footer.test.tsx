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

	it("states plainly that EdgeReco is open source and runs on the device", () => {
		render(<Footer />);
		expect(screen.getByText(/open source/i)).toBeInTheDocument();
		expect(screen.getByText(/runs on your device/i)).toBeInTheDocument();
	});

	it("links to the EdgeProc substrate repo on GitHub", () => {
		render(<Footer />);
		expect(
			screen.getByRole("link", { name: /EdgeProc substrate/i }),
		).toHaveAttribute("href", "https://github.com/hseshadr/edge-proc");
	});

	it("links to the EdgeProc entity page at its clean URL", () => {
		render(<Footer />);
		expect(
			screen.getByRole("link", { name: /What is EdgeProc/i }),
		).toHaveAttribute("href", "/edgeproc");
	});

	it("links to the FAQ entity page at its clean URL", () => {
		render(<Footer />);
		expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute(
			"href",
			"/faq",
		);
	});
});
