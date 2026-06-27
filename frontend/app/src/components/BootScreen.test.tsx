import type { BootStage } from "@edgeproc/browser";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BootScreen } from "./BootScreen";

afterEach(cleanup);

describe("BootScreen", () => {
	it("shows the boot lede and the three honest stages while booting", () => {
		render(<BootScreen stage={null} error={null} onRetry={vi.fn()} />);
		expect(
			screen.getByText(/Booting the engine in your tab/i),
		).toBeInTheDocument();
		expect(
			screen.getByText("Syncing the signed catalog bundle"),
		).toBeInTheDocument();
		expect(screen.getByText("Reassembling the index")).toBeInTheDocument();
		expect(screen.getByText("Loading the embedding model")).toBeInTheDocument();
	});

	it("marks earlier stages done and the current stage active", () => {
		render(
			<BootScreen
				stage={{ kind: "loading-model" }}
				error={null}
				onRetry={vi.fn()}
			/>,
		);
		const active = screen
			.getByText("Loading the embedding model")
			.closest("li");
		expect(active).toHaveClass("boot__step--active");
		const done = screen.getByText("Reassembling the index").closest("li");
		expect(done).toHaveClass("boot__step--done");
	});

	it("maps the 'synced' stage to the reassembling step", () => {
		// The synced stage carries a SyncResult the step indicator ignores; only
		// `kind` is read, so a kind-only stage exercises the synced→reassembling map.
		const synced = { kind: "synced" } as BootStage;
		render(<BootScreen stage={synced} error={null} onRetry={vi.fn()} />);
		expect(
			screen.getByText("Reassembling the index").closest("li"),
		).toHaveClass("boot__step--active");
	});

	it("renders the error state with a working Retry", async () => {
		const onRetry = vi.fn();
		render(
			<BootScreen stage={null} error="origin unreachable" onRetry={onRetry} />,
		);
		expect(screen.getByText("Couldn’t start the engine")).toBeInTheDocument();
		expect(screen.getByText("origin unreachable")).toBeInTheDocument();
		// The boot steps are replaced by the error panel.
		expect(
			screen.queryByText("Syncing the signed catalog bundle"),
		).not.toBeInTheDocument();

		await userEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(onRetry).toHaveBeenCalledOnce();
	});
});
