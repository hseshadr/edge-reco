import type { JSX } from "react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

/**
 * A subtle badge shown only when the browser is actually offline. The message is
 * the product thesis surfaced as a positive: the engine runs on the device, so a
 * dropped connection is a non-event. It never lies about connectivity.
 */
export function OfflineBadge(): JSX.Element | null {
	const online = useSyncExternalStore(
		subscribe,
		() => navigator.onLine,
		() => true,
	);
	if (online) {
		return null;
	}
	return (
		<div className="offline-badge" role="status">
			Offline — running fully on your device
		</div>
	);
}
