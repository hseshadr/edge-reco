import { useTranslation } from "react-i18next";
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

/**
 * Per-strategy tagline i18n keys (into the `storefront` namespace). The label
 * copy itself lives in the catalog; this maps only which key each rail uses,
 * with `rail.taglineDefault` as the fallback for any other strategy.
 */
const TAGLINE_KEYS: Readonly<Record<string, string>> = {
	for_you: "rail.taglineForYou",
	trending: "rail.taglineTrending",
	new_arrivals: "rail.taglineNewArrivals",
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
	const { t } = useTranslation("storefront");
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
						tagline={t(TAGLINE_KEYS[spec.strategy] ?? "rail.taglineDefault")}
						personalizing={isForYou && personalizing}
						{...(isForYou ? { signalCount } : {})}
					/>
				);
			})}
		</div>
	);
}
