import type { BootStage } from "@edgereco/browser";
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

	it("offers no cache clear unless the failure calls for it", () => {
		render(
			<BootScreen stage={null} error="origin unreachable" onRetry={vi.fn()} />,
		);
		expect(
			screen.queryByRole("button", { name: "Clear cached catalog and retry" }),
		).not.toBeInTheDocument();
	});

	it("renders the explicit clear-cached-catalog action and explains it plainly", async () => {
		const onRetry = vi.fn();
		const onClear = vi.fn();
		render(
			<BootScreen
				stage={null}
				error="pointer signature verification failed"
				onRetry={onRetry}
				cacheClear={{ onClear, confirm: false }}
			/>,
		);
		expect(
			screen.getByText(/saved copy of the catalog in this browser/i),
		).toBeInTheDocument();
		// Retry stays available alongside the recovery action.
		expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();

		await userEvent.click(
			screen.getByRole("button", { name: "Clear cached catalog and retry" }),
		);
		expect(onClear).toHaveBeenCalledOnce();
		expect(onRetry).not.toHaveBeenCalled();
	});

	it("warns about tampering on a rollback and requires an inline second click", async () => {
		const onClear = vi.fn();
		render(
			<BootScreen
				stage={null}
				error="pointer sequence 3 is below the stored floor 5"
				onRetry={vi.fn()}
				cacheClear={{ onClear, confirm: true }}
			/>,
		);
		// The plain-language warning is on screen BEFORE anything is cleared.
		expect(
			screen.getByText(
				/offered an older catalog than the one you already have/i,
			),
		).toBeInTheDocument();
		expect(screen.getByText(/someone is tampering/i)).toBeInTheDocument();

		// Step one only arms the confirm — nothing is cleared yet.
		await userEvent.click(
			screen.getByRole("button", { name: "Clear cached catalog and retry" }),
		);
		expect(onClear).not.toHaveBeenCalled();

		// Cancel backs out without clearing.
		await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
		expect(onClear).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("button", { name: "Yes, clear and retry" }),
		).not.toBeInTheDocument();

		// Step two, explicitly confirmed, clears.
		await userEvent.click(
			screen.getByRole("button", { name: "Clear cached catalog and retry" }),
		);
		await userEvent.click(
			screen.getByRole("button", { name: "Yes, clear and retry" }),
		);
		expect(onClear).toHaveBeenCalledOnce();
	});
});
