import type { JSX } from "react";
import { useInstallPrompt } from "../pwa/useInstallPrompt";

/** A small, dismissible "Install app" pill shown only when the browser offers it. */
export function InstallButton(): JSX.Element | null {
	const { canInstall, promptInstall } = useInstallPrompt();
	if (!canInstall) {
		return null;
	}
	return (
		<button
			type="button"
			className="install-pill"
			onClick={() => {
				void promptInstall();
			}}
		>
			Install app
		</button>
	);
}
