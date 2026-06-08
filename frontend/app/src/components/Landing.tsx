interface LandingProps {
	onLaunch: () => void;
}

interface Metric {
	num: string;
	unit?: string;
	tone?: "hot" | "pos";
	label: string;
	sub: string;
}

interface Why {
	title: string;
	body: string;
}

interface Step {
	n: string;
	label: string;
}

const METRICS: readonly Metric[] = [
	{
		num: "~36",
		unit: "ms",
		tone: "hot",
		label: "per recommendation",
		sub: "in-tab, no network hop",
	},
	{
		num: "0",
		tone: "pos",
		label: "backend calls after sync",
		sub: "search · recommend · rerank — all local",
	},
	{
		num: "~1.2",
		unit: "s",
		label: "cold start to first results",
		sub: "verify + load 720 products",
	},
	{
		num: "~22",
		unit: "MB",
		label: "JS heap (Chromium)",
		sub: "whole engine, in the tab",
	},
	{
		num: "$0",
		tone: "pos",
		label: "inference / 1k recs",
		sub: "illustrative · only CDN bandwidth",
	},
	{
		num: "720",
		label: "real products, in-tab",
		sub: "12 categories · 1.6 MB bundle",
	},
];

const WHYS: readonly Why[] = [
	{
		title: "Private",
		body: "Clicks shape the rail in-tab and never leave the device. The optional analytics uplink is off the inference path and off by default.",
	},
	{
		title: "Offline",
		body: "After the one-time sync the engine needs no network — it keeps working with the origin and edge down.",
	},
	{
		title: "Instant",
		body: "No per-query round trip. BM25 ⊕ vector → RRF → session rerank, all in the tab, in tens of milliseconds.",
	},
	{
		title: "Cheap to serve",
		body: "A static, signed, content-addressed bundle on a CDN. No embedding API, no vector DB, no ranking servers in the request path.",
	},
];

const STEPS: readonly Step[] = [
	{ n: "1", label: "sync signed bundle" },
	{ n: "2", label: "verify (Ed25519 + SHA-256, fail-closed)" },
	{ n: "3", label: "persist to OPFS" },
	{ n: "4", label: "load prebuilt index + embedder" },
	{ n: "5", label: "hybrid search + rerank, in-tab" },
];

function MetricTile({ metric }: { metric: Metric }) {
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
					<div className="landing__eyebrow">on-device · in your browser</div>
					<div className="wordmark">
						<span className="wordmark__name">
							Nimbus<span className="wordmark__dot">.</span>
						</span>
					</div>

					<h1 className="section-head__title landing__title">
						Product discovery that runs <em>entirely in your browser</em>.
					</h1>

					<p className="landing__lede">
						Most storefronts send every query and click to an embedding API, a
						vector database, and a ranking service you have to run, scale, and
						secure. EdgeReco moves that whole brain into the tab. Sync one
						signed catalog bundle, verify it cryptographically — then keyword +
						vector search, rank fusion, and per-session re-ranking all run
						locally. Private, offline-capable, instant, and basically free to
						operate.
					</p>

					<div className="landing__cta">
						<button
							type="button"
							className="landing__btn landing__btn--primary"
							onClick={onLaunch}
						>
							▶ Launch the live demo
						</button>
					</div>
					<p className="landing__footnote">
						First load fetches a ~1.6 MB signed bundle + a one-time embedding
						model, then everything is cached and offline.
					</p>
				</header>

				<section className="landing__band" aria-label="Performance">
					<div className="landing__band-head">
						<div className="section-head__title landing__band-title">
							Why it's <em>fast</em> — and what it costs
						</div>
						<div className="landing__band-live">representative figures</div>
					</div>
					<div className="landing__tiles">
						{METRICS.map((metric) => (
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
