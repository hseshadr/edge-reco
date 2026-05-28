import type { BootStage } from "@edgeproc/browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { bootstrap } from "./api/client";
import { BootScreen } from "./components/BootScreen";
import { Storefront } from "./components/Storefront";

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unexpected error";
}

/**
 * App is the bootstrap gate. On mount it spins up the engine Workers, syncs the
 * signed bundle into OPFS (verified ed25519+sha256), and warms the embedder —
 * showing real progress — then mounts the Storefront, which runs entirely in-tab
 * with no backend. A reachable origin makes reloads near-instant + offline-ready
 * (OPFS holds the bundle, the HTTP cache holds the model).
 */
export function App() {
	const [stage, setStage] = useState<BootStage | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	// Guards StrictMode's double-invoke within a single attempt; reset on retry.
	const ranAttempt = useRef(-1);

	useEffect(() => {
		if (ranAttempt.current === attempt) {
			return;
		}
		ranAttempt.current = attempt;
		setError(null);
		setStage(null);
		bootstrap(setStage)
			.then(() => setReady(true))
			.catch((err: unknown) => setError(errorMessage(err)));
	}, [attempt]);

	const onRetry = useCallback(() => setAttempt((n) => n + 1), []);

	if (!ready) {
		return <BootScreen stage={stage} error={error} onRetry={onRetry} />;
	}
	return <Storefront />;
}
