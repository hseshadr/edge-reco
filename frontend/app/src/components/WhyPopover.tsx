import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { ScoreComponents } from "../api/types";

type BarTone = "signal" | "abyss";

interface SignalRow {
	key: keyof ScoreComponents;
	/** Key into `storefront:why.signals.<labelKey>`. */
	labelKey: string;
	tone: BarTone;
}

const SIGNAL_ROWS: SignalRow[] = [
	{ key: "popularity", labelKey: "popularity", tone: "abyss" },
	{ key: "category_match", labelKey: "categoryMatch", tone: "signal" },
	{ key: "tag_match", labelKey: "tagMatch", tone: "signal" },
	{ key: "brand_match", labelKey: "brandMatch", tone: "signal" },
	{ key: "freshness", labelKey: "freshness", tone: "abyss" },
];

/** Clamps a raw component score to a 0..1 bar width as a CSS percentage. */
function widthPct(value: number): string {
	return `${Math.max(0, Math.min(1, Math.abs(value))) * 100}`.concat("%");
}

interface WhyPopoverProps {
	open: boolean;
	components: ScoreComponents;
}

export function WhyPopover({ open, components }: WhyPopoverProps) {
	const { t } = useTranslation("storefront");
	return (
		<AnimatePresence initial={false}>
			{open && (
				<motion.div
					className="why"
					initial={{ height: 0, opacity: 0 }}
					animate={{ height: "auto", opacity: 1 }}
					exit={{ height: 0, opacity: 0 }}
					transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
				>
					<div className="why__inner">
						<div className="why__head">{t("why.head")}</div>

						{SIGNAL_ROWS.map((row) => (
							<div className="why__row" key={row.key}>
								<div className="why__label">
									<span className="why__label-name">
										{t(`why.signals.${row.labelKey}`)}
									</span>
									<span className="why__label-val">
										{components[row.key].toFixed(2)}
									</span>
								</div>
								<div className="why__track">
									<motion.div
										className={`why__bar why__bar--${row.tone}`}
										initial={{ width: 0 }}
										animate={{ width: widthPct(components[row.key]) }}
										transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
									/>
								</div>
							</div>
						))}

						<div className="why__row why__row--penalty">
							<div className="why__label">
								<span className="why__label-name">
									{t("why.signals.repetitionPenalty")}
								</span>
								<span className="why__label-val">
									{components.repetition_penalty.toFixed(2)}
								</span>
							</div>
							<div className="why__track">
								<motion.div
									className="why__bar why__bar--penalty"
									initial={{ width: 0 }}
									animate={{ width: widthPct(components.repetition_penalty) }}
									transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
								/>
							</div>
						</div>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
