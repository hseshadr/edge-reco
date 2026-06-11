# Richer Interaction Signals (v0.9.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the missing UI emitters (favorite, add-to-cart, capped dwell views) for the interaction vocabulary the engine, uplink, and retrain already grade — zero engine/backend/weight/parity change.

**Architecture:** A new `frontend/app/src/signals/` module owns the per-type emit rules and toast copy; `ProductCard` is restructured from a `<button>` root to an `<article>` with a full-card overlay button plus layered signal buttons (nested buttons are invalid HTML); `Storefront` counts explicit signals app-side because the engine's parity-locked `clickCount` only counts clicks. Spec: `docs/superpowers/specs/2026-06-11-richer-signals-design.md`.

**Tech Stack:** React 19 + TypeScript 6 + Vite 8, vitest 4 + @testing-library/react, Playwright e2e, Biome (tabs, double quotes), pytest (backend), pnpm workspaces.

**Branch:** `feat/richer-signals` (create an isolated workspace via `superpowers:using-git-worktrees` at execution start, then `git checkout -b feat/richer-signals`).

**Load-bearing facts (verified 2026-06-11):**
- `EventType = "click" | "view" | "favorite" | "cart"` already exists; `sendEvent` in `frontend/app/src/api/client.ts:149-159` already folds ANY type via `applyInteraction` and enqueues the uplink.
- Engine `clickCount` increments ONLY for `click` (`frontend/packages/edgeproc-browser/src/engine/session.ts:93`) and is parity-locked — do NOT touch the package. The rail badge must therefore switch to an app-side count or favorites/carts won't register (and the cold-start gate `hasPicks` would wrongly stay cold after a first favorite).
- `ProductCard` root is currently `<motion.button>` (`ProductCard.tsx:14`); the e2e selector `main button.card` (`tests/e2e/storefront.spec.ts:34`) breaks when it becomes an article — Task 6 updates it.
- App runs in `StrictMode` (`main.tsx`) — never emit from inside a `setState` updater (double-invoked in dev).
- App tests mock the Storefront wholesale (`App.test.tsx`), so the card restructure does not touch them.
- jsdom has no `IntersectionObserver` — the dwell hook must no-op without it, and its tests stub the global.

---

### Task 1: Branch + worktree

**Files:** none (setup only)

- [ ] **Step 1: Create the isolated workspace and branch**

Use `superpowers:using-git-worktrees`, then:

```bash
git checkout -b feat/richer-signals
```

- [ ] **Step 2: Verify clean baseline**

Run: `cd frontend && pnpm -r run test 2>&1 | grep "Tests "`
Expected: `70 passed` (package) and `69 passed` (app).

---

### Task 2: Emit rules module — `signals/emit.ts`

**Files:**
- Create: `frontend/app/src/signals/emit.ts`
- Test: `frontend/app/src/signals/emit.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/app/src/signals/emit.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the data layer: these tests pin the EMIT RULES, not the engine fold.
const { sendEvent } = vi.hoisted(() => ({
	sendEvent: vi.fn((): Promise<void> => Promise.resolve()),
}));
vi.mock("../api/client", () => ({ sendEvent }));

import type { Product } from "../api/types";
import { __resetSignalsForTests, emitInteraction } from "./emit";

function makeProduct(id: string, overrides: Partial<Product> = {}): Product {
	return {
		id,
		title: `Product ${id}`,
		description: "",
		category: "Electronics",
		subcategories: [],
		tags: ["gadget"],
		brand: "Acme",
		price: 19.99,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
		...overrides,
	};
}

beforeEach(() => {
	sendEvent.mockClear();
	sendEvent.mockImplementation(() => Promise.resolve());
	__resetSignalsForTests();
});

describe("emitInteraction rules", () => {
	it("click: emits on every press with the taste toast", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("click", p);
		const second = await emitInteraction("click", p);
		expect(first).toEqual({
			emitted: true,
			message: "Added “Product P1” to your taste",
		});
		expect(second.emitted).toBe(true);
		expect(sendEvent).toHaveBeenCalledTimes(2);
		expect(sendEvent).toHaveBeenLastCalledWith({
			event_type: "click",
			product_id: "P1",
			timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
		});
	});

	it("favorite: once per product per session; other products unaffected", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("favorite", p);
		expect(first.emitted).toBe(true);
		expect(first.message).toContain("strong signal");
		const repeat = await emitInteraction("favorite", p);
		expect(repeat).toEqual({ emitted: false, message: null });
		const other = await emitInteraction("favorite", makeProduct("P2"));
		expect(other.emitted).toBe(true);
		expect(sendEvent).toHaveBeenCalledTimes(2);
	});

	it("favorite: a failed send does not consume the once-per-session budget", async () => {
		const p = makeProduct("P1");
		sendEvent.mockImplementationOnce(() => Promise.reject(new Error("boom")));
		await expect(emitInteraction("favorite", p)).rejects.toThrow("boom");
		const retry = await emitInteraction("favorite", p);
		expect(retry.emitted).toBe(true);
	});

	it("cart: emits every press; honesty note only on the session's first add", async () => {
		const first = await emitInteraction("cart", makeProduct("P1"));
		const second = await emitInteraction("cart", makeProduct("P1"));
		expect(first.message).toContain("nothing is purchased");
		expect(second.emitted).toBe(true);
		expect(second.message).toContain("strong signal");
		expect(second.message).not.toContain("nothing is purchased");
		expect(sendEvent).toHaveBeenCalledTimes(2);
	});

	it("view: once per product per session, always silent", async () => {
		const p = makeProduct("P1");
		const first = await emitInteraction("view", p);
		const repeat = await emitInteraction("view", p);
		expect(first).toEqual({ emitted: true, message: null });
		expect(repeat).toEqual({ emitted: false, message: null });
		expect(sendEvent).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm -F frontend run test -- src/signals/emit.test.ts`
Expected: FAIL — `Cannot find module './emit'` (or equivalent resolve error).

- [ ] **Step 3: Write the implementation**

Create `frontend/app/src/signals/emit.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && pnpm -F frontend run test -- src/signals/emit.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/src/signals/emit.ts frontend/app/src/signals/emit.test.ts
git commit -m "feat(signals): emit rules module — per-type caps + toast copy"
```

---

### Task 3: Dwell-view hook — `signals/useDwellViews.ts`

**Files:**
- Create: `frontend/app/src/signals/useDwellViews.ts`
- Test: `frontend/app/src/signals/useDwellViews.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/app/src/signals/useDwellViews.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../api/types";
import { DWELL_MS, DWELL_THRESHOLD, useDwellViews } from "./useDwellViews";

type Entry = { target: Element; isIntersecting: boolean };
type IOCallback = (entries: Entry[]) => void;

class FakeIntersectionObserver {
	static instances: FakeIntersectionObserver[] = [];
	readonly callback: IOCallback;
	readonly options: IntersectionObserverInit | undefined;
	readonly observed = new Set<Element>();
	disconnected = false;
	constructor(callback: IOCallback, options?: IntersectionObserverInit) {
		this.callback = callback;
		this.options = options;
		FakeIntersectionObserver.instances.push(this);
	}
	observe(el: Element): void {
		this.observed.add(el);
	}
	unobserve(el: Element): void {
		this.observed.delete(el);
	}
	disconnect(): void {
		this.disconnected = true;
		this.observed.clear();
	}
	intersect(el: Element, isIntersecting: boolean): void {
		this.callback([{ target: el, isIntersecting }]);
	}
}

function makeProduct(id: string): Product {
	return {
		id,
		title: `Product ${id}`,
		description: "",
		category: "Electronics",
		subcategories: [],
		tags: ["gadget"],
		brand: "Acme",
		price: 19.99,
		currency: "USD",
		popularity_score: 0.5,
		freshness_score: 0.5,
		image_url: "",
		url: "",
		attributes: {},
	};
}

function lastObserver(): FakeIntersectionObserver {
	const io = FakeIntersectionObserver.instances.at(-1);
	if (io === undefined) throw new Error("no IntersectionObserver created");
	return io;
}

beforeEach(() => {
	vi.useFakeTimers();
	FakeIntersectionObserver.instances = [];
	vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("useDwellViews", () => {
	it("fires onDwell after continuous visibility, once, then unobserves", () => {
		const onDwell = vi.fn();
		const { result } = renderHook(() => useDwellViews(onDwell));
		const product = makeProduct("P1");
		const el = document.createElement("div");
		result.current(product)(el);
		const io = lastObserver();
		expect(io.options?.threshold).toBe(DWELL_THRESHOLD);
		io.intersect(el, true);
		vi.advanceTimersByTime(DWELL_MS - 1);
		expect(onDwell).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(onDwell).toHaveBeenCalledExactlyOnceWith(product);
		expect(io.observed.has(el)).toBe(false);
	});

	it("a card that leaves the viewport before the dwell window does not fire", () => {
		const onDwell = vi.fn();
		const { result } = renderHook(() => useDwellViews(onDwell));
		const el = document.createElement("div");
		result.current(makeProduct("P1"))(el);
		const io = lastObserver();
		io.intersect(el, true);
		vi.advanceTimersByTime(DWELL_MS - 500);
		io.intersect(el, false);
		vi.advanceTimersByTime(DWELL_MS * 3);
		expect(onDwell).not.toHaveBeenCalled();
	});

	it("hiding the tab cancels pending dwell timers", () => {
		const onDwell = vi.fn();
		const { result } = renderHook(() => useDwellViews(onDwell));
		const el = document.createElement("div");
		result.current(makeProduct("P1"))(el);
		lastObserver().intersect(el, true);
		vi.advanceTimersByTime(DWELL_MS - 500);
		const vis = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("hidden");
		document.dispatchEvent(new Event("visibilitychange"));
		vi.advanceTimersByTime(DWELL_MS * 3);
		expect(onDwell).not.toHaveBeenCalled();
		vis.mockRestore();
	});

	it("returns a stable ref per product id (grid re-renders must not reset dwell)", () => {
		const { result } = renderHook(() => useDwellViews(vi.fn()));
		const product = makeProduct("P1");
		expect(result.current(product)).toBe(result.current(product));
	});

	it("unmount disconnects the observer", () => {
		const { result, unmount } = renderHook(() => useDwellViews(vi.fn()));
		result.current(makeProduct("P1"))(document.createElement("div"));
		const io = lastObserver();
		unmount();
		expect(io.disconnected).toBe(true);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm -F frontend run test -- src/signals/useDwellViews.test.ts`
Expected: FAIL — cannot resolve `./useDwellViews`.

- [ ] **Step 3: Write the implementation**

Create `frontend/app/src/signals/useDwellViews.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && pnpm -F frontend run test -- src/signals/useDwellViews.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/src/signals/useDwellViews.ts frontend/app/src/signals/useDwellViews.test.ts
git commit -m "feat(signals): capped dwell-view hook (IntersectionObserver, tab-visibility honest)"
```

---

### Task 4: ProductCard restructure + affordances + CSS

**Files:**
- Modify: `frontend/app/src/components/ProductCard.tsx` (full rewrite below)
- Modify: `frontend/app/src/index.css` (`.card` block at ~line 300; append new rules after `.card:hover .card__pick` at ~line 377)
- Test: `frontend/app/src/components/ProductCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/app/src/components/ProductCard.test.tsx`:

```tsx
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../api/types";
import { ProductCard } from "./ProductCard";

const product: Product = {
	id: "P1",
	title: "Walnut Desk Organizer",
	description: "",
	category: "Office Products",
	subcategories: [],
	tags: ["desk"],
	brand: "Acme",
	price: 24.5,
	currency: "USD",
	popularity_score: 0.5,
	freshness_score: 0.5,
	image_url: "",
	url: "",
	attributes: {},
};

function renderCard(overrides: { favorited?: boolean } = {}) {
	const onPick = vi.fn();
	const onFavorite = vi.fn();
	const onAddToCart = vi.fn();
	render(
		<ProductCard
			product={product}
			index={0}
			onPick={onPick}
			onFavorite={onFavorite}
			onAddToCart={onAddToCart}
			favorited={overrides.favorited ?? false}
			dwellRef={() => {}}
		/>,
	);
	return { onPick, onFavorite, onAddToCart };
}

afterEach(cleanup);

describe("ProductCard affordances", () => {
	it("full-card overlay picks the product", async () => {
		const { onPick, onFavorite, onAddToCart } = renderCard();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Add “Walnut Desk Organizer” to your taste",
			}),
		);
		expect(onPick).toHaveBeenCalledExactlyOnceWith(product);
		expect(onFavorite).not.toHaveBeenCalled();
		expect(onAddToCart).not.toHaveBeenCalled();
	});

	it("the heart favorites WITHOUT also picking (no double signal)", async () => {
		const { onPick, onFavorite } = renderCard();
		await userEvent.click(
			screen.getByRole("button", { name: "Favorite “Walnut Desk Organizer”" }),
		);
		expect(onFavorite).toHaveBeenCalledExactlyOnceWith(product);
		expect(onPick).not.toHaveBeenCalled();
	});

	it("add-to-cart fires WITHOUT also picking", async () => {
		const { onPick, onAddToCart } = renderCard();
		await userEvent.click(
			screen.getByRole("button", {
				name: "Add “Walnut Desk Organizer” to cart",
			}),
		);
		expect(onAddToCart).toHaveBeenCalledExactlyOnceWith(product);
		expect(onPick).not.toHaveBeenCalled();
	});

	it("favorited state: aria-pressed + Unfavorite label", () => {
		renderCard({ favorited: true });
		const heart = screen.getByRole("button", {
			name: "Unfavorite “Walnut Desk Organizer”",
		});
		expect(heart).toHaveAttribute("aria-pressed", "true");
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && pnpm -F frontend run test -- src/components/ProductCard.test.tsx`
Expected: FAIL — TS error: props `onFavorite`/`onAddToCart`/`favorited`/`dwellRef` do not exist on `ProductCardProps`.

- [ ] **Step 3: Rewrite ProductCard**

Replace the full contents of `frontend/app/src/components/ProductCard.tsx`:

```tsx
import { motion } from "motion/react";
import type { Product } from "../api/types";
import { formatPrice } from "../format";
import { ProductImage } from "./ProductImage";

interface ProductCardProps {
	product: Product;
	index: number;
	onPick: (product: Product) => void;
	onFavorite: (product: Product) => void;
	onAddToCart: (product: Product) => void;
	favorited: boolean;
	dwellRef: (el: HTMLElement | null) => void;
}

/**
 * One catalog card. The root is an <article> (NOT a button) because the card
 * hosts three distinct actions — the full-card "add to taste" overlay button
 * plus the favorite/cart signal buttons layered above it; nested buttons are
 * invalid HTML and break keyboard a11y. `dwellRef` is the ambient dwell-view
 * observer's hook onto the card root.
 */
export function ProductCard({
	product,
	index,
	onPick,
	onFavorite,
	onAddToCart,
	favorited,
	dwellRef,
}: ProductCardProps) {
	return (
		<motion.article
			className="card"
			ref={dwellRef}
			initial={{ opacity: 0, y: 18 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{
				duration: 0.45,
				delay: Math.min(index * 0.04, 0.6),
				ease: [0.22, 1, 0.36, 1],
			}}
			whileHover={{ y: -6, boxShadow: "var(--shadow-lift)" }}
		>
			<button
				type="button"
				className="card__overlay"
				aria-label={`Add “${product.title}” to your taste`}
				onClick={() => onPick(product)}
			/>
			<div className="card__actions">
				<button
					type="button"
					className={
						favorited ? "card__action card__action--active" : "card__action"
					}
					aria-pressed={favorited}
					aria-label={
						favorited
							? `Unfavorite “${product.title}”`
							: `Favorite “${product.title}”`
					}
					onClick={() => onFavorite(product)}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill={favorited ? "currentColor" : "none"}
						aria-hidden="true"
					>
						<path
							d="M12 20.3 4.7 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.3.4.3-.4a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7L12 20.3z"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					className="card__action"
					aria-label={`Add “${product.title}” to cart`}
					onClick={() => onAddToCart(product)}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M3 4h2.4l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<circle cx="10" cy="20" r="1.4" fill="currentColor" />
						<circle cx="17" cy="20" r="1.4" fill="currentColor" />
					</svg>
				</button>
			</div>
			<div className="card__media">
				<motion.div
					style={{ position: "absolute", inset: 0 }}
					whileHover={{ scale: 1.06 }}
					transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
				>
					<ProductImage product={product} />
				</motion.div>
			</div>
			<div className="card__body">
				{product.brand.trim() !== "" && (
					<span className="card__brand">{product.brand}</span>
				)}
				<span className="card__title">{product.title}</span>
				<div className="card__foot">
					<span className="card__price">
						{formatPrice(product.price, product.currency)}
					</span>
					<span className="card__pick">Add to taste &rarr;</span>
				</div>
			</div>
		</motion.article>
	);
}
```

- [ ] **Step 4: Add the CSS**

In `frontend/app/src/index.css`, add `position: relative;` to the existing `.card` rule (the block starting at ~line 300 — insert after `display: flex;`):

```css
.card {
	position: relative;
	display: flex;
	/* ...rest of the existing block unchanged... */
}
```

Then append AFTER the `.card:hover .card__pick { ... }` rule (~line 377):

```css
/* Signal affordances (v0.9.0): the card root is an <article>; the full-card
   "add to taste" action is the transparent overlay button, and the
   favorite / add-to-cart signal buttons are layered above it. */
.card__overlay {
	position: absolute;
	inset: 0;
	z-index: 1;
	border: 0;
	padding: 0;
	background: transparent;
	cursor: pointer;
}

.card__actions {
	position: absolute;
	top: 10px;
	right: 10px;
	z-index: 2;
	display: flex;
	gap: 6px;
}

.card__action {
	display: grid;
	place-items: center;
	width: 32px;
	height: 32px;
	padding: 0;
	border: 1px solid var(--line);
	border-radius: 999px;
	background: var(--paper-raise);
	color: var(--muted);
	cursor: pointer;
	box-shadow: var(--shadow-card);
	transition:
		color 0.18s ease,
		transform 0.18s ease;
}

.card__action:hover {
	color: var(--signal);
	transform: translateY(-1px);
}

.card__action--active {
	color: var(--signal);
	border-color: var(--signal);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd frontend && pnpm -F frontend run test -- src/components/ProductCard.test.tsx`
Expected: PASS — 4 tests. (`pnpm -F frontend run typecheck` will still FAIL because ProductGrid passes the old props — fixed in Task 5; that's expected mid-stack.)

- [ ] **Step 6: Commit**

```bash
git add frontend/app/src/components/ProductCard.tsx frontend/app/src/components/ProductCard.test.tsx frontend/app/src/index.css
git commit -m "feat(signals): card affordances — overlay pick + layered favorite/cart buttons"
```

---

### Task 5: Wiring — Storefront, ProductGrid, Header, RecommendRail

**Files:**
- Modify: `frontend/app/src/components/Storefront.tsx`
- Modify: `frontend/app/src/components/ProductGrid.tsx`
- Modify: `frontend/app/src/components/Header.tsx`
- Modify: `frontend/app/src/components/RecommendRail.tsx`
- Modify: `frontend/app/src/index.css` (cart pill)

- [ ] **Step 1: ProductGrid pass-through**

In `frontend/app/src/components/ProductGrid.tsx`, extend the props and pass them to each card. New interface and render call (skeleton/empty branches unchanged):

```tsx
interface ProductGridProps {
	products: Product[];
	kicker: string;
	title: string;
	loading: boolean;
	onPick: (product: Product) => void;
	onFavorite: (product: Product) => void;
	onAddToCart: (product: Product) => void;
	favoritedIds: ReadonlySet<string>;
	registerDwell: (product: Product) => (el: HTMLElement | null) => void;
}
```

```tsx
				<div className="grid">
					{products.map((product, index) => (
						<ProductCard
							key={product.id}
							product={product}
							index={index}
							onPick={onPick}
							onFavorite={onFavorite}
							onAddToCart={onAddToCart}
							favorited={favoritedIds.has(product.id)}
							dwellRef={registerDwell(product)}
						/>
					))}
				</div>
```

(Destructure the new props in the `ProductGrid({ ... })` signature accordingly.)

- [ ] **Step 2: RecommendRail prop rename**

In `frontend/app/src/components/RecommendRail.tsx`, rename `sessionClicks` → `sessionSignals` in the interface, destructuring, `hasPicks`, the badge `title`, and the badge text (5 occurrences; the CSS class `clicks-badge` stays — the e2e selector relies on it):

```tsx
interface RecommendRailProps {
	results: SearchResult[];
	sessionSignals: number;
	personalizing: boolean;
	onPick: (product: Product) => void;
}
```

```tsx
	const hasPicks = sessionSignals > 0;
```

```tsx
				<span
					className="clicks-badge"
					title={`${sessionSignals} signals captured this session`}
				>
					{sessionSignals}
				</span>
```

- [ ] **Step 3: Header cart pill**

In `frontend/app/src/components/Header.tsx`, add `cartCount: number` to `HeaderProps` and destructuring, then render the pill as the LAST child of `<div className="nimbus-header__bar">` (after the search `</div>`):

```tsx
				{cartCount > 0 && (
					<span
						className="cart-pill"
						title={`${cartCount} added to cart this session (demo signal — nothing is purchased)`}
					>
						<svg
							width="15"
							height="15"
							viewBox="0 0 24 24"
							fill="none"
							aria-hidden="true"
						>
							<path
								d="M3 4h2.4l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
							<circle cx="10" cy="20" r="1.4" fill="currentColor" />
							<circle cx="17" cy="20" r="1.4" fill="currentColor" />
						</svg>
						{cartCount}
					</span>
				)}
```

And append to `frontend/app/src/index.css` (after the `.clicks-badge` block at ~line 540, matching its pill vocabulary):

```css
.cart-pill {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	gap: 6px;
	height: 34px;
	padding: 0 12px;
	border-radius: 999px;
	border: 1px solid var(--line);
	background: var(--paper-raise);
	color: var(--ink);
	font-family: var(--font-display);
	font-weight: 600;
	font-size: 15px;
}
```

- [ ] **Step 4: Storefront wiring**

In `frontend/app/src/components/Storefront.tsx`:

(a) Imports — add:

```tsx
import { emitInteraction } from "../signals/emit";
import { useDwellViews } from "../signals/useDwellViews";
```

and extend the types import: `import type { EventType, Product, SearchResult } from "../api/types";`

(b) State — REPLACE `const [sessionClicks, setSessionClicks] = useState(0);` with:

```tsx
	// Explicit signals (click | favorite | cart) counted app-side: the engine's
	// parity-locked clickCount only counts clicks, and the badge + cold-start
	// gate must also register favorites/carts. Ambient views never count here.
	const [sessionSignals, setSessionSignals] = useState(0);
	const [cartCount, setCartCount] = useState(0);
	const [favoritedIds, setFavoritedIds] = useState<ReadonlySet<string>>(
		new Set(),
	);
```

(c) In `refreshRail`, DELETE the line `setSessionClicks(res.session_clicks);` (the response field still exists; the app deliberately stops consuming it).

(d) REPLACE the whole `onPick` callback with:

```tsx
	const emitExplicit = useCallback(
		async (eventType: EventType, product: Product): Promise<boolean> => {
			try {
				const { emitted, message } = await emitInteraction(eventType, product);
				if (!emitted) return false;
				if (message !== null) flashToast(message);
				setSessionSignals((n) => n + 1);
				await refreshRail();
				return true;
			} catch (err) {
				setError(errorMessage(err));
				return false;
			}
		},
		[refreshRail, flashToast],
	);

	const onPick = useCallback(
		async (product: Product) => {
			await emitExplicit("click", product);
		},
		[emitExplicit],
	);

	const onFavorite = useCallback(
		async (product: Product) => {
			const wasFavorited = favoritedIds.has(product.id);
			setFavoritedIds((prev) => {
				const next = new Set(prev);
				if (wasFavorited) next.delete(product.id);
				else next.add(product.id);
				return next;
			});
			// Unfavoriting is visual-only: negative signals are deferred (spec).
			if (!wasFavorited) await emitExplicit("favorite", product);
		},
		[favoritedIds, emitExplicit],
	);

	const onAddToCart = useCallback(
		async (product: Product) => {
			if (await emitExplicit("cart", product)) setCartCount((n) => n + 1);
		},
		[emitExplicit],
	);

	const onDwell = useCallback(
		(product: Product) => {
			// Ambient impression: silent, uncounted, and failures never surface —
			// a missed view must not interrupt browsing (same spirit as the uplink).
			void emitInteraction("view", product)
				.then((outcome) => (outcome.emitted ? refreshRail() : undefined))
				.catch(() => undefined);
		},
		[refreshRail],
	);
	const registerDwell = useDwellViews(onDwell);
```

(e) JSX — pass the new props:

```tsx
				<Header
					query={query}
					onQueryChange={setQuery}
					categories={categories}
					activeCategory={activeCategory}
					onSelectCategory={onSelectCategory}
					cartCount={cartCount}
				/>
```

```tsx
						<ProductGrid
							products={grid.products}
							kicker={grid.kicker}
							title={grid.title}
							loading={gridLoading}
							onPick={onPick}
							onFavorite={onFavorite}
							onAddToCart={onAddToCart}
							favoritedIds={favoritedIds}
							registerDwell={registerDwell}
						/>
```

```tsx
					<RecommendRail
						results={railResults}
						sessionSignals={sessionSignals}
						personalizing={personalizing}
						onPick={onPick}
					/>
```

- [ ] **Step 5: Verify the whole frontend suite + types + lint**

Run: `cd frontend && pnpm -r run typecheck && pnpm -r run lint && pnpm -r run test`
Expected: typecheck clean, biome clean, package 70 passed, app 83 passed (69 existing + 5 emit + 5 dwell + 4 card), none skipped.

- [ ] **Step 6: Commit**

```bash
git add frontend/app/src/components/Storefront.tsx frontend/app/src/components/ProductGrid.tsx frontend/app/src/components/Header.tsx frontend/app/src/components/RecommendRail.tsx frontend/app/src/index.css
git commit -m "feat(signals): wire favorite/cart/dwell into the storefront — app-side signal badge"
```

---

### Task 6: e2e — selectors + graded-signal beats

**Files:**
- Modify: `frontend/app/tests/e2e/storefront.spec.ts`

- [ ] **Step 1: Update the card selector**

At the top of the spec, replace:

```ts
const PRODUCT_CARD = "main button.card";
```

with:

```ts
// The card root became an <article> in v0.9.0; the full-card action is the
// overlay button (one per card, so counting overlays counts cards).
const PRODUCT_CARD = "main article.card button.card__overlay";
```

- [ ] **Step 2: Extend the hero test with favorite + cart beats**

In the existing hero test, AFTER the `"why?"` score-bars assertions and BEFORE the screenshot block, insert:

```ts
	// --- Graded signals (v0.9.0): favorite and cart are explicit signals too ---
	const firstCardActions = page
		.locator("main article.card")
		.first()
		.locator(".card__actions button");
	const toast = page.getByRole("status");

	await firstCardActions.nth(0).click(); // favorite
	await expect(badge).toHaveText("4"); // explicit-signal badge: 3 clicks + 1 favorite
	await expect(firstCardActions.nth(0)).toHaveAttribute("aria-pressed", "true");
	await expect(toast).toContainText("strong signal");

	await firstCardActions.nth(1).click(); // add to cart
	await expect(badge).toHaveText("5");
	await expect(page.locator(".cart-pill")).toHaveText(/1/);
	await expect(toast).toContainText("nothing is purchased"); // first-add honesty
```

- [ ] **Step 3: Add the cart-vs-clicks comparison test**

Append a new test to the same file:

```ts
test("graded signals: one cart-add re-ranks the rail at least as far as two clicks", async ({
	page,
}) => {
	// Per-facet affinity: one cart beats two clicks on EVERY facet
	// (category .25 > .20, tag .12 > .10, brand .20 > .16) — so at most as many
	// of the original rail titles survive a cart-add as survive two clicks.
	const overlap = (before: string[], after: string[]): number =>
		after.filter((t) => before.includes(t)).length;

	const boot = async (): Promise<string[]> => {
		await page.goto("/");
		await page.getByRole("button", { name: "▶ Launch the live demo" }).click();
		await expect(page.locator(PRODUCT_CARD).first()).toBeVisible({
			timeout: 60_000,
		});
		// Let the initial viewport's ambient dwell views fire (2 s window) and
		// the rail settle, so BOTH phases share the same baseline drift.
		await page.waitForTimeout(2_600);
		return (await page.locator(RAIL_TITLE).allTextContents()).map((t) =>
			t.trim(),
		);
	};

	// Phase 1: two clicks on the first card.
	const before1 = await boot();
	await page.locator(PRODUCT_CARD).first().click();
	await page.locator(PRODUCT_CARD).first().click();
	await expect(page.locator(`${RAIL} .clicks-badge`)).toHaveText("2");
	const afterClicks = (await page.locator(RAIL_TITLE).allTextContents()).map(
		(t) => t.trim(),
	);

	// Phase 2: fresh in-tab session (reload resets the profile; the bundle is
	// already in OPFS so the re-boot is fast). ONE cart-add on the SAME card.
	const before2 = await boot();
	expect(before2).toEqual(before1); // same catalog, same deterministic baseline
	await page
		.locator("main article.card")
		.first()
		.locator(".card__actions button")
		.nth(1)
		.click();
	await expect(page.locator(`${RAIL} .clicks-badge`)).toHaveText("1");
	const afterCart = (await page.locator(RAIL_TITLE).allTextContents()).map(
		(t) => t.trim(),
	);

	expect(overlap(before2, afterCart)).toBeLessThanOrEqual(
		overlap(before1, afterClicks),
	);
});
```

- [ ] **Step 4: Run the e2e suite**

Run: `cd frontend && pnpm -F frontend run test:e2e`
Expected: PASS — all storefront + landing tests green (the suite builds/serves per its Playwright config; first run may download the Chromium binary).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/tests/e2e/storefront.spec.ts
git commit -m "test(e2e): graded-signal beats — favorite/cart badges + one-cart ≥ two-clicks rail shift"
```

---

### Task 7: Backend — prove `/events` accepts the full vocabulary

**Files:**
- Modify: `backend/tests/integration/test_api_events.py` (append one test)

- [ ] **Step 1: Write the test (expected to pass immediately — it VERIFIES the zero-backend-change claim)**

Append to `backend/tests/integration/test_api_events.py`:

```python
def test_post_events_accepts_all_event_types(client: TestClient) -> None:
    """The collector accepts the full vocabulary the SPA emits as of v0.9.0."""
    session_id = str(uuid.uuid4())
    payload = {
        "events": [
            {"event_type": et, "product_id": "B001", "timestamp": "2026-06-11T00:00:00Z"}
            for et in ["click", "view", "favorite", "cart"]
        ]
    }
    response = client.post("/events", json=payload, headers={"X-Session-Id": session_id})
    assert response.status_code == 200
    assert response.json() == {"received": 4}
```

- [ ] **Step 2: Run it**

Run: `cd backend && uv run pytest tests/integration/test_api_events.py -v`
Expected: PASS, including the new test. If it FAILS, the zero-backend-change assumption is wrong — STOP and report; do not widen backend models without flagging it.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/integration/test_api_events.py
git commit -m "test(events): collector accepts the full click/view/favorite/cart vocabulary"
```

---

### Task 8: Docs — graded-signal copy

**Files:**
- Modify: `README.md`
- Modify: `docs/DEPLOY.md`
- Modify: `docs/ARCHITECTURE.md`

- [ ] **Step 1: README honesty + grading lines**

Three edits (exact old → new):

1. In the "**Nimbus is a pretend online store.**" paragraph: `and your clicks never leave your device.` → `and your clicks, hearts, and cart adds never leave your device.`
2. In the next paragraph, after `re-ranking **instantly, on-device, with no trip to a server.**` insert the sentence: `Hearts and cart-adds are stronger signals than clicks, and what you linger on nudges the rail gently.` Then in the same paragraph change `so your clicks never leave your device` → `so your signals never leave your device`.
3. In the "**See the flywheel:**" paragraph, after `so the cloud can retrain.` insert: `Signals are intent-graded — toward retrained popularity a cart-add weighs 4×, a favorite 3×, a click 1×, a lingered view 0.2× (the same grading both tiers use in-session).`

- [ ] **Step 2: DEPLOY.md flywheel bullets**

1. "**Flywheel uplink**" bullet: `the SPA captures each interaction in-tab` → `the SPA captures each interaction in-tab (clicks, favorites, cart-adds, capped dwell views)`.
2. "**Flywheel retrain**" bullet: after `recomputes each product's `popularity_score`` insert ` (intent-graded: cart 4× · favorite 3× · click 1× · view 0.2×)`.

- [ ] **Step 3: ARCHITECTURE.md storefront sentence**

`a search box and a "Recommended for you" rail that re-ranks live as the user clicks.` → `a search box and a "Recommended for you" rail that re-ranks live as the user clicks, favorites, adds to cart, or lingers.`

- [ ] **Step 4: Commit**

```bash
git add README.md docs/DEPLOY.md docs/ARCHITECTURE.md
git commit -m "docs: graded-signal copy — vocabulary, honesty lines, retrain weights"
```

---

### Task 9: Full gates + parity-untouched proof

**Files:** none (verification only)

- [ ] **Step 1: Prove the parity surface is untouched**

Run: `git diff main --stat -- frontend/packages backend/src`
Expected: EMPTY output (zero engine/runtime changes; backend diff is tests-only and lives under `backend/tests`).

- [ ] **Step 2: Backend gate**

Run: `cd backend && uv run poe gate`
Expected: fmt/lint/mypy/xenon clean; 159 tests pass (158 + the new events test); coverage ≥ 90% (was 99.76%).

- [ ] **Step 3: Frontend gates**

Run: `cd frontend && pnpm -r run lint && pnpm -r run typecheck && pnpm -r run test && pnpm -F frontend run test:preflight && pnpm -F frontend run build`
Expected: all clean/green; preflight 14 passed.

- [ ] **Step 4: e2e again on the final tree**

Run: `cd frontend && pnpm -F frontend run test:e2e`
Expected: PASS.

---

### Task 10: Live validation, merge, release v0.9.0

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `backend/pyproject.toml` (version), `backend/uv.lock` (via `uv lock`)

- [ ] **Step 1: Live-drive the real demo**

Start `make demo` (random ports — read the SPA URL from its output; Docker may need `open -a Docker`). Drive it with host Playwright (`@playwright/test` from `frontend/app/node_modules`; throwaway driver in `/tmp`, NEVER the Docker MCP browser — `host.docker.internal` is not a secure context, OPFS dies). Verify with evidence (screenshots to /tmp):
  - heart fills + toast "strong signal" + badge increments + rail re-ranks
  - cart add → toast with "nothing is purchased" (first add only) + header pill appears + rail re-ranks
  - linger 3 s on the grid → rail drifts with NO toast and NO badge change
  - browser console: no errors
Then stop (not down) the containers. If `poe demo-flywheel` is exercised, confirm the collector export contains typed events.

- [ ] **Step 2: CHANGELOG + version bump**

Under `## [Unreleased]` in `CHANGELOG.md`, add a `## [0.9.0] — <today's date>` section:

```markdown
## [0.9.0] — 2026-06-11

### Added
- **Richer interaction signals** — the storefront now emits the full graded
  vocabulary the engine and retrain already understood: a favorite heart
  (once per product per session), add-to-cart (every press; header pill), and
  capped ambient dwell views (≥75% visible for 2 s, once per product, silent).
  One cart-add re-ranks the rail harder than two clicks — asserted in e2e.
  Zero engine/backend/weight change; parity fixtures byte-identical.

### Changed
- The rail badge counts all explicit signals (clicks + favorites + cart-adds)
  app-side; product cards are now `<article>` roots with a full-card
  "add to taste" overlay button plus layered signal buttons.
```

Bump `version = "0.9.0"` in `backend/pyproject.toml`, then run `cd backend && uv lock` (refreshes the self-version in the lock).

```bash
git add CHANGELOG.md backend/pyproject.toml backend/uv.lock
git commit -m "chore(release): 0.9.0"
```

- [ ] **Step 3: Merge to main and push**

```bash
git checkout main && git merge --no-ff feat/richer-signals -m "Merge feat/richer-signals: graded interaction signals (favorite/cart/dwell)"
git push && git branch -d feat/richer-signals
```

(Clean up the worktree if one was used.)

- [ ] **Step 4: Tag + GitHub release + CI watch**

```bash
git tag -a v0.9.0 -m "v0.9.0 — richer interaction signals"
git push origin v0.9.0
gh release create v0.9.0 --title "v0.9.0 — richer interaction signals" --notes-from-tag
```

Watch both CI lanes (`gh run list`/`gh run watch`); the HF-CDN `hybridParity` flake may need ONE rerun of the failed job (`gh run rerun <id> --failed`) — documented, environmental.

---

## Self-review (spec coverage)

- Emit rules table (click/favorite/cart/view + no-double-click) → Tasks 2, 4 (overlay/sibling layering test "WITHOUT also picking").
- Dwell trigger 0.75/2 s, capped, tab-honest, silent → Tasks 3, 5(d) `onDwell`.
- Signal-first affordances, per-session visible state → Tasks 4, 5.
- App-side badge + cold-start gate fix → Task 5(b)(c) + RecommendRail rename.
- Honesty copy (first-cart toast, README lines) → Tasks 2 (toastFor), 8.
- One-cart ≥ two-clicks demo beat → Task 6 Step 3.
- Backend zero-change verification → Task 7 (STOP-and-report guard).
- Parity untouched → Task 9 Step 1.
- Error handling (explicit → banner, ambient → swallow, cap not consumed on failure) → Tasks 2, 5(d).
- Out-of-scope guarded: no `frontend/packages` or `backend/src` diffs (Task 9 Step 1).
- Release flow → Task 10.
