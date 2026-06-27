import type { Product, SearchResult } from "../api/types";
import { RailRow } from "./RailRow";
import type { RailSpec } from "./railSelection";

/** The data a single home rail renders: its spec plus its current results. */
export interface RailData {
	readonly spec: RailSpec;
	readonly results: SearchResult[];
}

interface RailStackProps {
	rails: RailData[];
	onPick: (product: Product) => void;
	/** True while the personalized (For You) rail is re-ranking. */
	personalizing: boolean;
	/** Session-signal count shown on the For-You rail (the hero-loop badge). */
	signalCount: number;
}

const TAGLINES: Readonly<Record<string, string>> = {
	for_you: "live re-ranking",
	trending: "by popularity",
	new_arrivals: "freshest first",
};

/**
 * The home view's vertical stack of horizontally-scrolling rails. For You
 * re-ranks live as you interact; Trending / New arrivals stay stable. Rails
 * with no results are dropped so the stack never shows an empty shell.
 */
export function RailStack({
	rails,
	onPick,
	personalizing,
	signalCount,
}: RailStackProps) {
	const nonEmpty = rails.filter((rail) => rail.results.length > 0);
	if (nonEmpty.length === 0) {
		return null;
	}
	return (
		<div className="rail-stack">
			{nonEmpty.map(({ spec, results }) => {
				const isForYou = spec.strategy === "for_you";
				return (
					<RailRow
						key={spec.strategy}
						railId={spec.strategy}
						label={spec.label}
						results={results}
						onPick={onPick}
						tagline={TAGLINES[spec.strategy] ?? "in-tab ranking"}
						personalizing={isForYou && personalizing}
						{...(isForYou ? { signalCount } : {})}
					/>
				);
			})}
		</div>
	);
}
