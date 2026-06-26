import {
	LANDING_FOOTNOTE,
	LANDING_METRICS,
	type RepresentativeMetric,
} from "../metrics/landing-figures";

interface LandingProps {
	onLaunch: () => void;
}

interface Why {
	title: string;
	body: string;
}

interface Step {
	n: string;
	label: string;
}

const WHYS: readonly Why[] = [
	{
		title: "Private",
		body: "By default, what your shoppers do stays on their own device. The optional learning loop is off until you switch it on.",
	},
	{
		title: "Offline",
		body: "Once the one-time download finishes, the store keeps working even if the network drops.",
	},
	{
		title: "Instant",
		body: "No trip to a server — answers come back on the shopper's own device in a blink.",
	},
	{
		title: "Cheap to run",
		body: "No per-search cloud bill. You hand out one small file, and each shopper's device does the work.",
	},
	{
		title: "Always learning",
		body: "Switch on an optional loop — off by default — and your store learns from anonymous, grouped activity to send everyone sharper picks. The shopping itself still runs entirely on each device.",
	},
];

const STEPS: readonly Step[] = [
	{ n: "1", label: "sync signed bundle" },
	{ n: "2", label: "verify (Ed25519 + SHA-256, fail-closed)" },
	{ n: "3", label: "persist to OPFS" },
	{ n: "4", label: "load prebuilt index + embedder" },
	{ n: "5", label: "hybrid search + rerank, in-tab" },
];

function MetricTile({ metric }: { metric: RepresentativeMetric }) {
	const toneClass = metric.tone ? ` metric-tile__num--${metric.tone}` : "";
	return (
		<div className="metric-tile">
			<div className={`metric-tile__num${toneClass}`}>
				{metric.num}
				{metric.unit ? (
					<span className="metric-tile__unit">{metric.unit}</span>
				) : null}
			</div>
			<div className="metric-tile__label">{metric.label}</div>
			<div className="metric-tile__sub">{metric.sub}</div>
		</div>
	);
}

/**
 * Landing is a pure presentational intro shown BEFORE the engine boots. It never
 * imports or starts the engine — the only interactivity is the Launch CTA, which
 * lifts a callback so App can flip into the boot path. The metric band shows
 * REPRESENTATIVE figures (the engine isn't running here yet); honesty labels —
 * "JS heap (Chromium)", "illustrative" — keep the numbers truthful.
 */
export function Landing({ onLaunch }: LandingProps) {
	return (
		<main className="landing">
			<div className="landing__wrap">
				<header className="landing__hero">
					<div className="landing__eyebrow">
						search & recommendations that run on the shopper's device
					</div>
					<div className="wordmark">
						<span className="wordmark__name">EdgeReco</span>
					</div>

					<h1 className="section-head__title landing__title">
						Your store gets busier. Your recommendation bill <em>shouldn't</em>.
					</h1>

					<p className="landing__kicker">
						More shoppers, more power — not more cost.
					</p>

					<p className="landing__lede">
						Today, every search and click runs through paid cloud services, and
						your company pays the bill for each one — for every shopper — then
						rents enough computing power to survive Black Friday all year.
						EdgeReco flips that: your store sends each shopper's browser one
						small file — your products plus the logic that ranks them — just
						once. After that, search, ranking, and "you might also like" run
						right on their device, with nothing sent back to a server. So every
						shopper brings their own device — a phone, a laptop, an in-store
						kiosk. The more popular you get, the more capacity you have, your
						cost stays flat, and there's no server in the middle to slow down or
						crash.
					</p>

					<div className="landing__cta">
						<button
							type="button"
							className="landing__btn landing__btn--primary"
							onClick={onLaunch}
						>
							▶ Launch the live demo
						</button>
						<a
							className="landing__btn landing__btn--ghost"
							href="https://github.com/hseshadr/edge-reco"
							target="_blank"
							rel="noreferrer"
						>
							View source on GitHub
						</a>
					</div>
					<p className="landing__demo-note">
						What you're about to open is Nimbus — our example storefront, built
						on 720 real products to show the engine running in a real shop.
					</p>
					<p className="landing__footnote">{LANDING_FOOTNOTE}</p>
				</header>

				<section className="landing__band" aria-label="Performance">
					<div className="landing__band-head">
						<div className="section-head__title landing__band-title">
							Why it's <em>fast</em> — and what it costs
						</div>
						<div className="landing__band-live">representative figures</div>
					</div>
					<div className="landing__tiles">
						{LANDING_METRICS.map((metric) => (
							<MetricTile key={metric.label} metric={metric} />
						))}
					</div>
				</section>

				<section className="landing__why" aria-label="Why">
					{WHYS.map((why) => (
						<article key={why.title} className="landing__why-card">
							<div className="landing__why-key">{why.title}</div>
							<div className="landing__why-desc">{why.body}</div>
						</article>
					))}
				</section>

				<section className="landing__how" aria-label="How it works">
					<div className="landing__how-title">How it works</div>
					<ol className="landing__steps">
						{STEPS.map((step, i) => (
							<li key={step.n} className="landing__step-item">
								<span className="landing__step">
									<b>{step.n}</b>
									{step.label}
								</span>
								{i < STEPS.length - 1 ? (
									<span className="landing__arrow" aria-hidden="true">
										→
									</span>
								) : null}
							</li>
						))}
					</ol>
				</section>
			</div>
		</main>
	);
}
