import { AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Product, SearchResult } from "../api/types";
import { RailCard } from "./RailCard";

interface RailRowProps {
	/**
	 * Stable, unique rail identity (the strategy key / PDP rail key) — NOT the
	 * display label. The heading id derives from this so two rails that happen to
	 * share a label still emit distinct DOM ids / aria-labelledby targets.
	 */
	railId: string;
	label: string;
	results: SearchResult[];
	onPick: (product: Product) => void;
	/** Shown on the right of the head; e.g. "live re-ranking" / "popularity". */
	tagline?: string;
	/** True while a re-rank is in flight (drives the pulse dot). */
	personalizing?: boolean;
	/** Optional session-signal count badge (the For-You hero-loop counter). */
	signalCount?: number;
	/**
	 * Optional "Reset taste" affordance next to the signal badge: clears the
	 * durable in-browser activity log + live profile (wired by Storefront).
	 */
	onResetTaste?: () => void;
}

/**
 * Drop later results whose normalized title already appeared in this rail. The
 * catalog carries distinct-ASIN rows with identical titles (some even under
 * different brands), and the card shows only the title — so without this an
 * "also bought"/Trending rail could render two visually-identical cards. This is
 * an APP-RENDER-LAYER concern only: the shared engine's ranking/selection output
 * is untouched (parity preserved), we just hide the visual duplicate at display.
 */
function dedupeByTitle(results: SearchResult[]): SearchResult[] {
	const seen = new Set<string>();
	const unique: SearchResult[] = [];
	for (const result of results) {
		const key = result.product.title.toLowerCase().trim().replace(/\s+/g, " ");
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		unique.push(result);
	}
	return unique;
}

/**
 * A horizontally-scrolling rail: a labeled region (so screen readers announce
 * "Trending now, region") whose items reuse the same `RailCard` as the sticky
 * For-You rail. The scroller is keyboard-focusable (`tabIndex={0}`) with a
 * visible focus ring, so arrow keys scroll the row without a mouse. Empty rails
 * are hidden by the caller (PDP vector rails degrade gracefully).
 */
export function RailRow({
	railId,
	label,
	results,
	onPick,
	tagline,
	personalizing = false,
	signalCount,
	onResetTaste,
}: RailRowProps) {
	const { t } = useTranslation("storefront");
	const headingId = `rail-${slug(railId)}`;
	const cards = dedupeByTitle(results);

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
							{personalizing ? t("rail.personalizing") : tagline}
						</div>
					)}
				</div>
				{(signalCount !== undefined || onResetTaste !== undefined) && (
					<div className="rail__taste">
						{signalCount !== undefined && (
							<span
								className="clicks-badge"
								title={t("rail.signals", { n: signalCount })}
							>
								{signalCount}
							</span>
						)}
						{onResetTaste !== undefined && (
							<button
								type="button"
								className="rail__reset"
								onClick={onResetTaste}
								title={t("rail.resetTasteHint")}
							>
								{t("rail.resetTaste")}
							</button>
						)}
					</div>
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
				aria-label={t("rail.scrollable", { label })}
			>
				<ul className="rail__track-list">
					<AnimatePresence initial={false}>
						{cards.map((result, index) => (
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
