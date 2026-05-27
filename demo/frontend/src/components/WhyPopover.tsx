import { AnimatePresence, motion } from "motion/react";
import type { ScoreComponents } from "../api/types";

type BarTone = "signal" | "abyss";

interface SignalRow {
	key: keyof ScoreComponents;
	label: string;
	tone: BarTone;
}

const SIGNAL_ROWS: SignalRow[] = [
	{ key: "popularity", label: "Popularity", tone: "abyss" },
	{ key: "category_match", label: "Category match", tone: "signal" },
	{ key: "tag_match", label: "Tag match", tone: "signal" },
	{ key: "brand_match", label: "Brand match", tone: "signal" },
	{ key: "freshness", label: "Freshness", tone: "abyss" },
];

/** Clamps a raw component score to a 0..1 bar width. */
function widthPct(value: number): number {
	return `${Math.max(0, Math.min(1, Math.abs(value))) * 100}`.concat("%");
}

interface WhyPopoverProps {
	open: boolean;
	components: ScoreComponents;
}

export function WhyPopover({ open, components }: WhyPopoverProps) {
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
						<div className="why__head">Why this ranks here</div>

						{SIGNAL_ROWS.map((row) => (
							<div className="why__row" key={row.key}>
								<div className="why__label">
									<span className="why__label-name">{row.label}</span>
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
								<span className="why__label-name">Repetition penalty</span>
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
