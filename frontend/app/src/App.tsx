import type { BootStage } from "@edgeproc/browser";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { bootstrap } from "./api/client";
import { BootScreen } from "./components/BootScreen";
import { InstallButton } from "./components/InstallButton";
import { Landing } from "./components/Landing";
import { OfflineBadge } from "./components/OfflineBadge";
import { Storefront } from "./components/Storefront";
import { record } from "./metrics/store";

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : "Unexpected error";
}

/**
 * App is the launch gate. It first shows the Landing intro and starts NOTHING —
 * the engine stays cold until the user clicks Launch. On launch it spins up the
 * engine Workers, syncs the signed bundle into OPFS (verified ed25519+sha256),
 * and warms the embedder — showing real progress — then mounts the Storefront,
 * which runs entirely in-tab with no backend. A reachable origin makes reloads
 * near-instant + offline-ready (OPFS holds the bundle, the service worker the app shell + model).
 */
export function App() {
	const [launched, setLaunched] = useState(false);
	const [stage, setStage] = useState<BootStage | null>(null);
	const [ready, setReady] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [attempt, setAttempt] = useState(0);
	// Guards StrictMode's double-invoke within a single attempt; reset on retry.
	const ranAttempt = useRef(-1);

	useEffect(() => {
		// Hold the engine cold until the user launches — the Landing never boots it.
		if (!launched) {
			return;
		}
		if (ranAttempt.current === attempt) {
			return;
		}
		ranAttempt.current = attempt;
		setError(null);
		setStage(null);
		const t0 = performance.now();
		bootstrap(setStage)
			.then(() => {
				record({ coldStartMs: performance.now() - t0 });
				setReady(true);
			})
			.catch((err: unknown) => setError(errorMessage(err)));
	}, [launched, attempt]);

	const onRetry = useCallback(() => setAttempt((n) => n + 1), []);
	const onLaunch = useCallback(() => setLaunched(true), []);

	let screen: ReactNode;
	if (!launched) {
		screen = <Landing onLaunch={onLaunch} />;
	} else if (!ready) {
		screen = <BootScreen stage={stage} error={error} onRetry={onRetry} />;
	} else {
		screen = <Storefront />;
	}

	return (
		<>
			{screen}
			<OfflineBadge />
			<InstallButton />
		</>
	);
}
