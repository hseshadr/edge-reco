import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Toast } from "./Toast";

afterEach(cleanup);

describe("Toast", () => {
	it("renders nothing when there is no message", () => {
		render(<Toast message={null} />);
		expect(screen.queryByRole("status")).not.toBeInTheDocument();
	});

	it("renders the message as a polite status when present", () => {
		render(<Toast message="Favorited “Walnut Desk”" />);
		const status = screen.getByRole("status");
		expect(status).toHaveTextContent("Favorited “Walnut Desk”");
	});
});
