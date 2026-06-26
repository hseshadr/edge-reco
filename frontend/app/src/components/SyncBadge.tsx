import { useEffect, useState } from "react";
import { onUplinkSynced, uplinkEnabled } from "../telemetry/uplink";

/**
 * A small, unobtrusive status pill that makes the flywheel visible: how many
 * interactions have been flushed to the mimicked cloud. When the uplink is
 * disabled (the default backend-free demo — `VITE_EVENTS_URL` unset) it states
 * plainly that everything runs on-device, so the headline stays legible.
 */
export function SyncBadge() {
	const enabled = uplinkEnabled();
	const [synced, setSynced] = useState(0);

	useEffect(() => {
		if (!enabled) {
			return;
		}
		// Cumulative confirmed count; the callback receives an absolute total, so
		// repeated calls are idempotent (StrictMode double-invoke is harmless).
		onUplinkSynced(setSynced);
	}, [enabled]);

	if (!enabled) {
		return (
			<div className="sync-badge sync-badge--local" role="status">
				<span className="sync-badge__dot" />
				Running fully on-device · no uplink
			</div>
		);
	}

	return (
		<div className="sync-badge" role="status">
			<span className="sync-badge__dot" />
			{synced === 0
				? "Flywheel uplink armed · interactions sync to cloud"
				: `${synced} interaction${synced === 1 ? "" : "s"} synced to cloud`}
		</div>
	);
}
