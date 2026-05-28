import type { BootStage } from "@edgeproc/browser";

interface BootScreenProps {
	stage: BootStage | null;
	error: string | null;
	onRetry: () => void;
}

interface StepView {
	readonly label: string;
	readonly detail: string;
}

const ORDER: ReadonlyArray<BootStage["kind"]> = [
	"syncing",
	"reassembling",
	"loading-model",
	"ready",
];

const STEPS: ReadonlyArray<StepView> = [
	{
		label: "Syncing the signed catalog bundle",
		detail: "ed25519 + sha256, into OPFS",
	},
	{ label: "Reassembling the index", detail: "products, embeddings, vectors" },
	{
		label: "Loading the embedding model",
		detail: "all-MiniLM-L6-v2 in a Worker (~25 MB, cached)",
	},
];

/** Map a live stage to the index of the currently-active step (0-based). */
function activeStep(stage: BootStage | null): number {
	if (stage === null) {
		return 0;
	}
	if (stage.kind === "synced") {
		return ORDER.indexOf("reassembling");
	}
	const index = ORDER.indexOf(stage.kind);
	return index < 0 ? 0 : index;
}

/**
 * Full-screen bootstrap UX. Shows the real stages — syncing the signed bundle,
 * reassembling the index, loading the model — so the first-load work is honest,
 * and an error+retry path if the origin is unreachable. After the first load
 * the bundle lives in OPFS and the model in the HTTP cache, so this screen is
 * near-instant offline.
 */
export function BootScreen({ stage, error, onRetry }: BootScreenProps) {
	const current = activeStep(stage);
	return (
		<div className="boot" role="status" aria-live="polite">
			<div className="boot__card">
				<div className="wordmark boot__mark">
					<span className="wordmark__name">
						Nimbus<span className="wordmark__dot">.</span>
					</span>
					<span className="wordmark__tag">on-device, in your browser</span>
				</div>

				{error === null ? (
					<>
						<p className="boot__lede">
							Booting the engine in your tab — no backend, no server-side
							search.
						</p>
						<ol className="boot__steps">
							{STEPS.map((step, index) => {
								const state =
									index < current
										? "boot__step--done"
										: index === current
											? "boot__step--active"
											: "boot__step--pending";
								return (
									<li key={step.label} className={`boot__step ${state}`}>
										<span className="boot__dot" aria-hidden="true" />
										<span className="boot__step-text">
											<span className="boot__step-label">{step.label}</span>
											<span className="boot__step-detail">{step.detail}</span>
										</span>
									</li>
								);
							})}
						</ol>
					</>
				) : (
					<div className="boot__error">
						<div className="boot__error-title">Couldn’t start the engine</div>
						<p className="boot__error-copy">{error}</p>
						<button type="button" className="banner__retry" onClick={onRetry}>
							Retry
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
