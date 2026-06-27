import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDebounced } from "./useDebounced";

describe("useDebounced", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("returns the initial value immediately", () => {
		const { result } = renderHook(() => useDebounced("a", 300));
		expect(result.current).toBe("a");
	});

	it("delays updates until the delay has elapsed without a change", () => {
		const { result, rerender } = renderHook(
			({ value }) => useDebounced(value, 300),
			{ initialProps: { value: "a" } },
		);

		rerender({ value: "b" });
		// Not yet — the debounce window has not closed.
		expect(result.current).toBe("a");

		act(() => vi.advanceTimersByTime(299));
		expect(result.current).toBe("a");

		act(() => vi.advanceTimersByTime(1));
		expect(result.current).toBe("b");
	});

	it("coalesces rapid changes into the final value (resets the timer)", () => {
		const { result, rerender } = renderHook(
			({ value }) => useDebounced(value, 300),
			{ initialProps: { value: "a" } },
		);

		rerender({ value: "b" });
		act(() => vi.advanceTimersByTime(200));
		rerender({ value: "c" });
		act(() => vi.advanceTimersByTime(200));
		// 400ms total elapsed, but the last change was 200ms ago — still pending.
		expect(result.current).toBe("a");

		act(() => vi.advanceTimersByTime(100));
		expect(result.current).toBe("c");
	});
});
