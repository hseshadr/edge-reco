import { useCallback, useEffect, useState } from "react";

/** The non-standard install prompt event (Chromium). Typed locally — not in lib.dom. */
interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/**
 * Captures the browser's install prompt so the app can offer an in-page "Install"
 * affordance instead of relying on the easily-missed address-bar icon. `canInstall`
 * is true only while a deferred prompt is in hand; it clears once the user chooses
 * or the app is installed.
 */
export function useInstallPrompt(): {
	canInstall: boolean;
	promptInstall: () => Promise<void>;
} {
	const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
		null,
	);

	useEffect(() => {
		function onBip(event: Event) {
			event.preventDefault(); // suppress the default mini-infobar; we drive the prompt
			setDeferred(event as BeforeInstallPromptEvent);
		}
		function onInstalled() {
			setDeferred(null);
		}
		window.addEventListener("beforeinstallprompt", onBip);
		window.addEventListener("appinstalled", onInstalled);
		return () => {
			window.removeEventListener("beforeinstallprompt", onBip);
			window.removeEventListener("appinstalled", onInstalled);
		};
	}, []);

	const promptInstall = useCallback(async () => {
		if (deferred === null) {
			return;
		}
		await deferred.prompt();
		await deferred.userChoice;
		setDeferred(null); // a deferred prompt can only be used once
	}, [deferred]);

	return { canInstall: deferred !== null, promptInstall };
}
