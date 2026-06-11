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
