import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInstallPrompt } from "./useInstallPrompt";

/** Build a fake beforeinstallprompt event with a controllable userChoice. */
function bipEvent(outcome: "accepted" | "dismissed") {
	const evt = new Event("beforeinstallprompt") as Event & {
		prompt: () => Promise<void>;
		userChoice: Promise<{ outcome: string }>;
		preventDefault: () => void;
	};
	evt.preventDefault = vi.fn();
	evt.prompt = vi.fn().mockResolvedValue(undefined);
	evt.userChoice = Promise.resolve({ outcome });
	return evt;
}

describe("useInstallPrompt", () => {
	it("is not installable until beforeinstallprompt fires", () => {
		const { result } = renderHook(() => useInstallPrompt());
		expect(result.current.canInstall).toBe(false);
	});

	it("becomes installable and suppresses the default infobar", () => {
		const { result } = renderHook(() => useInstallPrompt());
		const evt = bipEvent("accepted");
		act(() => {
			window.dispatchEvent(evt);
		});
		expect(evt.preventDefault).toHaveBeenCalled();
		expect(result.current.canInstall).toBe(true);
	});

	it("prompts and stops being installable after the choice", async () => {
		const { result } = renderHook(() => useInstallPrompt());
		const evt = bipEvent("accepted");
		act(() => {
			window.dispatchEvent(evt);
		});
		await act(async () => {
			await result.current.promptInstall();
		});
		expect(evt.prompt).toHaveBeenCalled();
		expect(result.current.canInstall).toBe(false);
	});
});
