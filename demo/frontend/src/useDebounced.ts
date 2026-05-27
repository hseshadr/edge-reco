import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `delayMs`
 * has elapsed without a change. Used to throttle search-as-you-type.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState<T>(value);

	useEffect(() => {
		const handle = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(handle);
	}, [value, delayMs]);

	return debounced;
}
