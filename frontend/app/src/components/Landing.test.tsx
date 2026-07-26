import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Landing } from "./Landing";

afterEach(cleanup);

describe("Landing", () => {
	it("renders the headline and its cost-story accent", () => {
		render(<Landing onLaunch={() => {}} />);
		const heading = screen.getByRole("heading", { level: 1 });
		expect(heading).toHaveTextContent(
			"Your store gets busier. Your recommendation bill shouldn't.",
		);
		// the accent phrase is an <em> styled with --signal
		expect(heading.querySelector("em")).toHaveTextContent("shouldn't");
	});

	it("renders all six representative metric tiles", () => {
		render(<Landing onLaunch={() => {}} />);
		const labels = [
			"per recommendation",
			"backend calls after sync",
			"cold start to first results",
			"JS heap (Chromium)",
			"inference / 1k recs",
			"real products, in-tab",
		];
		for (const label of labels) {
			expect(screen.getByText(label)).toBeInTheDocument();
		}
		// honesty labels are present, not scrubbed
		expect(screen.getByText("JS heap (Chromium)")).toBeInTheDocument();
		expect(
			screen.getByText("illustrative · only CDN bandwidth"),
		).toBeInTheDocument();
	});

	it("renders the five why cards and the footnote", () => {
		render(<Landing onLaunch={() => {}} />);
		for (const k of [
			"Private",
			"Offline",
			"Instant",
			"Cheap to run",
			"Always learning",
		]) {
			expect(screen.getByText(k)).toBeInTheDocument();
		}
		// the flywheel is a first-class value prop, framed honestly
		expect(
			screen.getByText(/Switch on an optional loop — off by default/),
		).toBeInTheDocument();
		// the Private card is reframed: shopper activity stays on-device by default,
		// the optional learning loop is off until switched on
		expect(
			screen.getByText(
				/The optional learning loop is off until you switch it on/,
			),
		).toBeInTheDocument();
		expect(screen.getByText(/~2\.2 MB signed bundle/)).toBeInTheDocument();
	});

	it("calls onLaunch when the Launch CTA is clicked", async () => {
		const onLaunch = vi.fn();
		render(<Landing onLaunch={onLaunch} />);
		await userEvent.click(
			screen.getByRole("button", { name: /Launch the live demo/i }),
		);
		expect(onLaunch).toHaveBeenCalledTimes(1);
	});
});
