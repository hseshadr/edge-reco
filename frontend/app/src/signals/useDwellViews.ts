import { useCallback, useEffect, useRef } from "react";
import type { Product } from "../api/types";

/** A card must be ≥75% visible for 2 continuous seconds to count as a view. */
export const DWELL_MS = 2000;
export const DWELL_THRESHOLD = 0.75;

type DwellRef = (el: HTMLElement | null) => void;

/**
 * Ambient dwell impressions. Detects "the user lingered on this card"
 * (≥DWELL_THRESHOLD visible for DWELL_MS while the tab is visible), calls
 * onDwell once per element, then stops watching it. The once-per-PRODUCT
 * session cap lives in signals/emit.ts — this hook only detects dwell.
 *
 * Returns a registrar: registerDwell(product) -> a STABLE callback ref for
 * that product's card root. Stability matters: the grid re-renders on every
 * rail refresh, and an unstable ref would re-mount observation and reset the
 * dwell timer each time.
 * The registrar cache is bounded by distinct products seen this session
 * (≤ catalog size) — intentional, the price of ref stability, not a leak.
 *
 * Honesty guards: timers cancel when the card leaves the viewport or the tab
 * hides. (After a tab re-show the timer restarts on the next intersection
 * change, not immediately — a deliberate simplification; with the session cap
 * a missed dwell costs nothing.)
 */
export function useDwellViews(
	onDwell: (product: Product) => void,
): (product: Product) => DwellRef {
	const onDwellRef = useRef(onDwell);
	onDwellRef.current = onDwell;

	const refByProductId = useRef(new Map<string, DwellRef>());
	const elementByProductId = useRef(new Map<string, HTMLElement>());
	const productByElement = useRef(new Map<Element, Product>());
	const timerByElement = useRef(new Map<Element, number>());
	const observerRef = useRef<IntersectionObserver | null>(null);

	const clearTimer = useCallback((el: Element) => {
		const timer = timerByElement.current.get(el);
		if (timer !== undefined) {
			window.clearTimeout(timer);
			timerByElement.current.delete(el);
		}
	}, []);

	const getObserver = useCallback((): IntersectionObserver | null => {
		if (observerRef.current !== null) return observerRef.current;
		// jsdom (consumers' unit tests) has no IntersectionObserver: dwell
		// detection silently disables itself rather than crashing the render.
		if (typeof IntersectionObserver === "undefined") return null;
		observerRef.current = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const visible =
						entry.isIntersecting && document.visibilityState === "visible";
					if (!visible) {
						clearTimer(entry.target);
						continue;
					}
					if (timerByElement.current.has(entry.target)) continue;
					const el = entry.target;
					timerByElement.current.set(
						el,
						window.setTimeout(() => {
							timerByElement.current.delete(el);
							const product = productByElement.current.get(el);
							observerRef.current?.unobserve(el);
							productByElement.current.delete(el);
							if (product !== undefined) onDwellRef.current(product);
						}, DWELL_MS),
					);
				}
			},
			{ threshold: DWELL_THRESHOLD },
		);
		return observerRef.current;
	}, [clearTimer]);

	useEffect(() => {
		const onVisibility = () => {
			if (document.visibilityState !== "visible") {
				for (const el of [...timerByElement.current.keys()]) clearTimer(el);
			}
		};
		document.addEventListener("visibilitychange", onVisibility);
		return () => {
			document.removeEventListener("visibilitychange", onVisibility);
			for (const el of [...timerByElement.current.keys()]) clearTimer(el);
			observerRef.current?.disconnect();
			observerRef.current = null;
		};
	}, [clearTimer]);

	return useCallback(
		(product: Product): DwellRef => {
			const cached = refByProductId.current.get(product.id);
			if (cached !== undefined) return cached;
			const ref: DwellRef = (el) => {
				const prev = elementByProductId.current.get(product.id);
				if (prev !== undefined) {
					clearTimer(prev);
					observerRef.current?.unobserve(prev);
					productByElement.current.delete(prev);
					elementByProductId.current.delete(product.id);
				}
				if (el === null) return;
				elementByProductId.current.set(product.id, el);
				productByElement.current.set(el, product);
				getObserver()?.observe(el);
			};
			refByProductId.current.set(product.id, ref);
			return ref;
		},
		[clearTimer, getObserver],
	);
}
