const SESSION_KEY = "nimbus_session_id";

/**
 * Generates a UUID-ish id. `crypto.randomUUID` only exists in secure contexts;
 * `crypto.getRandomValues` keeps the plain-http LAN / Docker fallback secure.
 */
function generateSessionId(): string {
	if (typeof crypto === "undefined") {
		throw new Error("Web Crypto is required to generate a session id");
	}
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	const random = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `nimbus-${random}`;
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
