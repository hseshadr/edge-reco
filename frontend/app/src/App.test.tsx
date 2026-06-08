import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the engine boot + the Storefront so the launch gate can be tested in
// isolation: we only care that the engine stays cold until Launch is clicked.
// vi.hoisted keeps the spy available inside the hoisted vi.mock factory.
const { bootstrap } = vi.hoisted(() => ({
	bootstrap: vi.fn(() => new Promise<void>(() => {})),
}));
vi.mock("./api/client", () => ({ bootstrap }));
vi.mock("./components/Storefront", () => ({
	Storefront: () => <div>storefront</div>,
}));

import { App } from "./App";

afterEach(() => {
	cleanup();
	bootstrap.mockClear();
});

describe("App launch gate", () => {
	it("shows the Landing first and does NOT boot the engine", () => {
		render(<App />);
		expect(
			screen.getByRole("button", { name: /Launch the live demo/i }),
		).toBeInTheDocument();
		expect(bootstrap).not.toHaveBeenCalled();
	});

	it("boots the engine only after Launch is clicked", async () => {
		render(<App />);
		expect(bootstrap).not.toHaveBeenCalled();
		await userEvent.click(
			screen.getByRole("button", { name: /Launch the live demo/i }),
		);
		expect(bootstrap).toHaveBeenCalledTimes(1);
		// engine pending -> boot screen, landing gone
		expect(
			screen.queryByRole("button", { name: /Launch the live demo/i }),
		).not.toBeInTheDocument();
	});
});
