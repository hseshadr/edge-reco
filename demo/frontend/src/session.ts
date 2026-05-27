const SESSION_KEY = "nimbus_session_id";

/**
 * Returns a stable per-browser session id, creating and persisting one
 * in localStorage on first access. Subsequent calls return the same id.
 */
export function getSessionId(): string {
	const existing = localStorage.getItem(SESSION_KEY);
	if (existing !== null && existing !== "") {
		return existing;
	}
	const created = crypto.randomUUID();
	localStorage.setItem(SESSION_KEY, created);
	return created;
}
