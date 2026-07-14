import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { onUplinkSynced, uplinkEnabled } from "../telemetry/uplink";

/**
 * A small, unobtrusive status pill that makes the flywheel visible: how many
 * interactions have been flushed to the mimicked cloud. When the uplink is
 * disabled (the default backend-free demo — `VITE_EVENTS_URL` unset) it states
 * plainly that everything runs on-device, so the headline stays legible.
 */
export function SyncBadge() {
	const { t } = useTranslation("storefront");
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
				{t("syncBadge.local")}
			</div>
		);
	}

	return (
		<div className="sync-badge" role="status">
			<span className="sync-badge__dot" />
			{synced === 0
				? t("syncBadge.armed")
				: t("syncBadge.synced", { count: synced })}
		</div>
	);
}
