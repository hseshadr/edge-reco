import { AnimatePresence, motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { RankingProofEvidence, SearchResult } from "../api/types";

type ScoreExplanation = NonNullable<SearchResult["score_explanation"]>;
type ExplainedRow = ScoreExplanation["components"][number];

const LABEL_KEYS: Readonly<Record<string, string>> = {
	retrieval: "retrieval",
	popularity: "popularity",
	category_match: "categoryMatch",
	tag_match: "tagMatch",
	brand_match: "brandMatch",
	freshness: "freshness",
	similarity: "similarity",
	cooccurrence: "cooccurrence",
	repetition_penalty: "repetitionPenalty",
};

function widthPct(value: number): string {
	return `${Math.max(0, Math.min(1, Math.abs(value))) * 100}%`;
}

function number(value: number): string {
	return String(value);
}

function equation(row: ExplainedRow): string {
	const sign = row.operation === "subtract" ? "−" : "+";
	return `${number(row.raw)} × ${number(row.coefficient)} = ${sign}${number(
		row.contribution,
	)}`;
}

interface WhyPopoverProps {
	open: boolean;
	explanation: ScoreExplanation;
	proofEvidence: RankingProofEvidence;
}

function Verification({ evidence }: { evidence: RankingProofEvidence }) {
	const { t } = useTranslation("storefront");
	if (evidence.status === "verified") {
		return (
			<ul className="why__checks">
				<li className="why__check why__check--ok">
					{t("why.verified.signature")}
				</li>
				<li className="why__check why__check--ok">
					{t("why.verified.config")}
				</li>
			</ul>
		);
	}
	if (evidence.status === "failed") {
		const signatureTone =
			evidence.publisherSignature === "verified" ? "ok" : "bad";
		const signatureCopy =
			evidence.publisherSignature === "verified"
				? t("why.verified.signature")
				: evidence.publisherSignature === "failed"
					? t("why.failed.signature")
					: t("why.failed.signatureNotChecked");
		return (
			<ul className="why__checks">
				<li className={`why__check why__check--${signatureTone}`}>
					{signatureCopy}
				</li>
				<li className="why__check why__check--bad">
					{evidence.configHash === "mismatch"
						? t("why.failed.config")
						: t("why.failed.proof")}
				</li>
			</ul>
		);
	}
	return (
		<p className="why__unavailable">
			{t(`why.unavailable.${evidence.reason}`)}
		</p>
	);
}

export function WhyPopover({
	open,
	explanation,
	proofEvidence,
}: WhyPopoverProps) {
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
						<section className="why__section">
							<h3 className="why__head">{t("why.calculationHead")}</h3>
							<p className="why__intro">{t("why.calculationIntro")}</p>
							{explanation.components.map((row) => (
								<div
									className={`why__row${
										row.operation === "subtract" ? " why__row--penalty" : ""
									}`}
									key={row.id}
								>
									<div className="why__label">
										<span className="why__label-name">
											{t(`why.signals.${LABEL_KEYS[row.id] ?? row.id}`, {
												defaultValue: row.id,
											})}
										</span>
										<span className="why__label-val">{equation(row)}</span>
									</div>
									<div className="why__track">
										<motion.div
											className={`why__bar why__bar--${
												row.operation === "subtract" ? "penalty" : "signal"
											}`}
											initial={{ width: 0 }}
											animate={{ width: widthPct(row.contribution) }}
											transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
										/>
									</div>
								</div>
							))}
							<div className="why__total">
								<span>{t("why.total")}</span>
								<strong>{number(explanation.score)}</strong>
							</div>
						</section>

						<section className="why__section why__section--verification">
							<h3 className="why__head">{t("why.verificationHead")}</h3>
							<Verification evidence={proofEvidence} />
							<p className="why__limits">{t("why.limitStatic")}</p>
							<p className="why__limits">{t("why.limitScope")}</p>
						</section>
					</div>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
