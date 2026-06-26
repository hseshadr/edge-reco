import { AnimatePresence } from "motion/react";
import type { Product, SearchResult } from "../api/types";
import { RailCard } from "./RailCard";

interface RailRowProps {
	label: string;
	results: SearchResult[];
	onPick: (product: Product) => void;
	/** Shown on the right of the head; e.g. "live re-ranking" / "popularity". */
	tagline?: string;
	/** True while a re-rank is in flight (drives the pulse dot). */
	personalizing?: boolean;
	/** Optional session-signal count badge (the For-You hero-loop counter). */
	signalCount?: number;
}

/**
 * A horizontally-scrolling rail: a labeled region (so screen readers announce
 * "Trending now, region") whose items reuse the same `RailCard` as the sticky
 * For-You rail. The scroller is keyboard-focusable (`tabIndex={0}`) with a
 * visible focus ring, so arrow keys scroll the row without a mouse. Empty rails
 * are hidden by the caller (PDP vector rails degrade gracefully).
 */
export function RailRow({
	label,
	results,
	onPick,
	tagline,
	personalizing = false,
	signalCount,
}: RailRowProps) {
	const headingId = `rail-${slug(label)}`;

	return (
		<section className="rail rail--row" aria-labelledby={headingId}>
			<div className="rail__head">
				<div>
					<h2 className="rail__title" id={headingId}>
						{label}
					</h2>
					{tagline !== undefined && (
						<div className="rail__sub">
							<span
								className={`rail__pulse${
									personalizing ? " rail__pulse--on" : ""
								}`}
							/>
							{personalizing ? "personalizing…" : tagline}
						</div>
					)}
				</div>
				{signalCount !== undefined && (
					<span
						className="clicks-badge"
						title={`${signalCount} signals captured this session`}
					>
						{signalCount}
					</span>
				)}
			</div>

			{/* A labeled, focusable scroll region: a legit keyboard target (arrow
			    keys scroll it) with an accessible name, per WAI-ARIA scrollable-
			    region guidance — the list inside stays non-interactive. */}
			{/* biome-ignore lint/a11y/useSemanticElements: a scroll container is not a fieldset */}
			<div
				role="group"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: a keyboard-scrollable region needs a tab stop
				tabIndex={0}
				className="rail__track"
				aria-label={`${label}, scrollable`}
			>
				<ul className="rail__track-list">
					<AnimatePresence initial={false}>
						{results.map((result, index) => (
							<RailCard
								key={result.product.id}
								product={result.product}
								rank={index + 1}
								score={result.score}
								components={result.score_components}
								onPick={onPick}
							/>
						))}
					</AnimatePresence>
				</ul>
			</div>
		</section>
	);
}

function slug(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/(^-|-$)/g, "");
}
