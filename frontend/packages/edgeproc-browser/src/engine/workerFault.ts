// Typed failures for the main-thread Worker clients. A Worker that crashes
// during init (module-eval throw, script load failure) never posts a reply, so
// without these the callers' pending promises hang forever. The clients
// translate Worker 'error' / 'messageerror' events — plus a bounded response
// deadline as a backstop — into typed rejections.

/** The Worker fired 'error'/'messageerror': every in-flight request rejects. */
export class WorkerCrashError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "WorkerCrashError";
	}
}

/** A request outlived its response deadline (backstop for silent hangs). */
export class WorkerTimeoutError extends Error {
	public constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "WorkerTimeoutError";
	}
}

/** Default per-request response deadline for the engine sync client. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Default deadline for the embedder client. Deliberately larger: the FIRST
 * embed request also downloads + compiles the ~25 MB model, which on a slow
 * link legitimately takes minutes — a tight deadline would reject real users.
 */
export const DEFAULT_EMBED_TIMEOUT_MS = 300_000;
