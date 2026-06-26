// Interaction-signal emit rules — the ONE place that decides whether a user
// action becomes an engine event, and what the UI says about it.
//
// The engine, uplink, and retrain already grade the full vocabulary
// (click | view | favorite | cart); this module owns the per-type EMIT RULES
// from docs/superpowers/specs/2026-06-11-richer-signals-design.md:
//
//   click     every press
//   favorite  once per product per session, on the first transition to
//             favorited (unfavoriting emits nothing — negative signals are
//             deferred)
//   cart      every press (repeated intent = repeated signal)
//   view      once per product per session (ambient dwell impressions)
//
// Caps are per-tab-session module state ON PURPOSE: they share the engine
// SessionProfile's lifetime, so a refresh honestly resets both together.

import { sendEvent } from "../api/client";
import type { EventType, Product } from "../api/types";

export interface SignalOutcome {
	/** Whether an event was actually sent (engine fold + optional uplink). */
	readonly emitted: boolean;
	/** Toast copy; null for silent signals (views) and capped no-ops. */
	readonly message: string | null;
}

const favoriteEmitted = new Set<string>();
const viewEmitted = new Set<string>();
let cartHonestyShown = false;

/** Test seam: a real session resets by reloading the tab. */
export function __resetSignalsForTests(): void {
	favoriteEmitted.clear();
	viewEmitted.clear();
	cartHonestyShown = false;
}

function isCapped(eventType: EventType, product: Product): boolean {
	if (eventType === "favorite") return favoriteEmitted.has(product.id);
	if (eventType === "view") return viewEmitted.has(product.id);
	return false;
}

// Split from isCapped so a FAILED sendEvent does not consume the
// once-per-session budget.
function commitCap(eventType: EventType, product: Product): void {
	if (eventType === "favorite") favoriteEmitted.add(product.id);
	if (eventType === "view") viewEmitted.add(product.id);
}

function toastFor(eventType: EventType, product: Product): string | null {
	switch (eventType) {
		case "click":
			return `Added “${product.title}” to your taste`;
		case "favorite":
			return `Favorited “${product.title}” — strong signal, rail reweighted`;
		case "cart": {
			const honesty = cartHonestyShown
				? ""
				: " (demo: a ranking signal — nothing is purchased)";
			cartHonestyShown = true;
			return `“${product.title}” in the cart — strong signal, rail reweighted${honesty}`;
		}
		case "view":
			return null;
	}
}

/**
 * Apply the per-type emit rule and, if allowed, send the event down the
 * existing path (in-tab engine fold + optional flywheel uplink). Errors
 * propagate: explicit-action handlers surface them in the UI; the ambient
 * dwell path deliberately swallows them.
 */
export async function emitInteraction(
	eventType: EventType,
	product: Product,
): Promise<SignalOutcome> {
	if (isCapped(eventType, product)) {
		return { emitted: false, message: null };
	}
	await sendEvent({
		event_type: eventType,
		product_id: product.id,
		timestamp: new Date().toISOString(),
	});
	commitCap(eventType, product);
	return { emitted: true, message: toastFor(eventType, product) };
}
