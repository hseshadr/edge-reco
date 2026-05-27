const SESSION_KEY = "nimbus_session_id";

/**
 * Generates a UUID-ish id. `crypto.randomUUID` only exists in secure contexts
 * (https or localhost); when the demo is served over plain http on a non-localhost
 * host (LAN / Docker edge), it is undefined, so fall back to a random string.
 */
function generateSessionId(): string {
	if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `nimbus-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Returns a stable per-browser session id, creating and persisting one
 * in localStorage on first access. Subsequent calls return the same id.
 */
export function getSessionId(): string {
	const existing = localStorage.getItem(SESSION_KEY);
	if (existing !== null && existing !== "") {
		return existing;
	}
	const created = generateSessionId();
	localStorage.setItem(SESSION_KEY, created);
	return created;
}
