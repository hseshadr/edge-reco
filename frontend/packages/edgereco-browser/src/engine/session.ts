// In-browser session profile, ported from edge-reco's reco/signals.py +
// catalog/models.SessionProfile. A profile is an affinity sketch built from a
// stream of interaction events; the reranker (reranker.ts) reads it to
// personalize results. Math matches signals.py byte-for-byte: per-event-type
// category/tag/brand bumps capped at 1.0, a recently-viewed list (deduped,
// most-recent first, capped at 50), and a click counter.

import type { EventType, InteractionEvent, Product } from "./domain";
import {
	DEFAULT_RANKING_CONFIG,
	type InteractionWeights,
} from "./rankingConfig";

/** Affinity sketch over a browsing session. Maps mirror Python dicts. */
export interface SessionProfile {
	readonly categoryAffinity: ReadonlyMap<string, number>;
	readonly tagAffinity: ReadonlyMap<string, number>;
	readonly brandAffinity: ReadonlyMap<string, number>;
	readonly recentlyViewed: ReadonlyArray<string>;
	readonly clickCount: number;
}

/** Max entries kept in recently_viewed (signals.py RECENTLY_VIEWED_CAP). */
export const RECENTLY_VIEWED_CAP = 50;

/** An empty profile (Python SessionProfile() defaults). */
export function emptyProfile(): SessionProfile {
	return {
		categoryAffinity: new Map(),
		tagAffinity: new Map(),
		brandAffinity: new Map(),
		recentlyViewed: [],
		clickCount: 0,
	};
}

function bump(current: number, delta: number): number {
	return Math.min(1.0, current + delta);
}

function bumped(
	affinity: ReadonlyMap<string, number>,
	key: string,
	delta: number,
): Map<string, number> {
	const next = new Map(affinity);
	next.set(key, bump(next.get(key) ?? 0, delta));
	return next;
}

/**
 * Apply one interaction, returning a new profile (signals.apply_interaction).
 * `interactionWeights` come from the synced bundle's ranking_config.json; they
 * default to DEFAULT_RANKING_CONFIG so call sites keep today's affinity bumps.
 */
export function applyInteraction(
	profile: SessionProfile,
	product: Product,
	eventType: EventType,
	interactionWeights: InteractionWeights = DEFAULT_RANKING_CONFIG.interaction_weights,
): SessionProfile {
	const weights = interactionWeights[eventType];

	const categoryAffinity = bumped(
		profile.categoryAffinity,
		product.category,
		weights.category,
	);

	let tagAffinity: ReadonlyMap<string, number> = profile.tagAffinity;
	for (const tag of product.tags) {
		tagAffinity = bumped(tagAffinity, tag, weights.tag);
	}

	const brandAffinity = product.brand
		? bumped(profile.brandAffinity, product.brand, weights.brand)
		: new Map(profile.brandAffinity);

	const viewed = [
		product.id,
		...profile.recentlyViewed.filter((pid) => pid !== product.id),
	].slice(0, RECENTLY_VIEWED_CAP);

	return {
		categoryAffinity,
		tagAffinity,
		brandAffinity,
		recentlyViewed: viewed,
		clickCount: profile.clickCount + (eventType === "click" ? 1 : 0),
	};
}

/**
 * Fold a stream of events into a profile, given a product lookup. Unknown
 * product ids are skipped (matching the backend's events route, which logs and
 * ignores them). This is how the demo builds a profile in-browser from clicks.
 */
export function buildProfile(
	events: ReadonlyArray<InteractionEvent>,
	productById: ReadonlyMap<string, Product>,
	interactionWeights: InteractionWeights = DEFAULT_RANKING_CONFIG.interaction_weights,
): SessionProfile {
	let profile = emptyProfile();
	for (const event of events) {
		const product = productById.get(event.product_id);
		if (product !== undefined) {
			profile = applyInteraction(
				profile,
				product,
				event.event_type,
				interactionWeights,
			);
		}
	}
	return profile;
}
