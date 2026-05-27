import { AnimatePresence } from "motion/react";
import type { Product, SearchResult } from "../api/types";
import { RailCard } from "./RailCard";

interface RecommendRailProps {
	results: SearchResult[];
	sessionClicks: number;
	personalizing: boolean;
	onPick: (product: Product) => void;
}

function ColdStart() {
	return (
		<div className="rail__cold">
			<div className="rail__cold-glyph">{"\u{2728}"}</div>
			<div className="rail__cold-title">Your taste starts here</div>
			<p className="rail__cold-copy">
				Click any product and watch this rail re-rank toward you. Open
				<strong> why? </strong>
				to see exactly which signals moved it.
			</p>
		</div>
	);
}

export function RecommendRail({
	results,
	sessionClicks,
	personalizing,
	onPick,
}: RecommendRailProps) {
	const hasPicks = sessionClicks > 0;

	return (
		<aside className="rail" aria-label="Recommended for you">
			<div className="rail__head">
				<div>
					<h2 className="rail__title">Recommended for you</h2>
					<div className="rail__sub">
						<span
							className={`rail__pulse${personalizing ? " rail__pulse--on" : ""}`}
						/>
						{personalizing ? "personalizing…" : "live re-ranking"}
					</div>
				</div>
				<span
					className="clicks-badge"
					title={`${sessionClicks} signals captured this session`}
				>
					{sessionClicks}
				</span>
			</div>

			{!hasPicks && results.length === 0 ? (
				<ColdStart />
			) : (
				<ul className="rail__list">
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
			)}
		</aside>
	);
}
