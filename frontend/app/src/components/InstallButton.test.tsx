import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstallButton } from "./InstallButton";

/** A fake beforeinstallprompt event the hook latches onto. */
function bipEvent() {
	const evt = new Event("beforeinstallprompt") as Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: string }>;
		preventDefault: () => void;
	};
	evt.preventDefault = vi.fn();
	evt.prompt = vi.fn().mockResolvedValue(undefined);
	evt.userChoice = Promise.resolve({ outcome: "accepted" });
	return evt;
}

afterEach(cleanup);

describe("InstallButton", () => {
	it("renders nothing until the browser offers an install prompt", () => {
		render(<InstallButton />);
		expect(
			screen.queryByRole("button", { name: "Install app" }),
		).not.toBeInTheDocument();
	});

	it("shows the pill once installable and prompts on click", async () => {
		render(<InstallButton />);
		const evt = bipEvent();
		act(() => {
			window.dispatchEvent(evt);
		});

		const pill = screen.getByRole("button", { name: "Install app" });
		await userEvent.click(pill);
		expect(evt.prompt).toHaveBeenCalled();
	});
});
