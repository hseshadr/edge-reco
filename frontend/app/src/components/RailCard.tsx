import { motion } from "motion/react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	Product,
	RankingProofEvidence,
	ScoreComponents,
	SearchResult,
} from "../api/types";
import { formatPrice } from "../format";
import { ProductImage } from "./ProductImage";
import { WhyPopover } from "./WhyPopover";

interface RailCardProps {
	product: Product;
	rank: number;
	score: number;
	/** Legacy contribution map retained only for the shared response contract. */
	components: ScoreComponents | null;
	explanation?: SearchResult["score_explanation"];
	proofEvidence?: RankingProofEvidence;
	onPick: (product: Product) => void;
}

export function RailCard({
	product,
	rank,
	score,
	explanation,
	proofEvidence,
	onPick,
}: RailCardProps) {
	const { t } = useTranslation("storefront");
	const [showWhy, setShowWhy] = useState(false);

	return (
		<motion.li
			className="rail-card"
			layout
			transition={{ type: "spring", stiffness: 380, damping: 34 }}
		>
			<button
				type="button"
				className="rail-card__main"
				onClick={() => onPick(product)}
			>
				<span className="rail-card__rank">{rank}</span>
				<div className="rail-card__media">
					<ProductImage product={product} />
				</div>
				<div className="rail-card__info">
					<span className="rail-card__title">{product.title}</span>
					<div className="rail-card__meta">
						<span className="rail-card__price">
							{formatPrice(product.price, product.currency)}
						</span>
						<span className="rail-card__score">{score.toFixed(2)}</span>
					</div>
				</div>
			</button>

			{explanation != null && (
				<>
					<button
						type="button"
						className={`rail-card__why-btn${
							showWhy ? " rail-card__why-btn--open" : ""
						}`}
						onClick={() => setShowWhy((v) => !v)}
						aria-expanded={showWhy}
					>
						{showWhy ? t("rail.hide") : t("rail.why")}
					</button>
					<WhyPopover
						open={showWhy}
						explanation={explanation}
						proofEvidence={
							proofEvidence ?? {
								status: "unavailable",
								publisherSignature: "not_checked",
								configHash: "not_checked",
								reason: "missing",
							}
						}
					/>
				</>
			)}
		</motion.li>
	);
}
