import { useTranslation } from "react-i18next";

/**
 * Small, always-visible site footer. Anchors the site's internal links: it states
 * plainly that EdgeReco is open source and runs on-device, points at the GitHub
 * repos and the entity pages (/edgeproc, /faq) so both shoppers and crawlers can
 * follow the link graph, and keeps the honest disclaimers (Nimbus is a fictional
 * demo store; the catalog data is attributed).
 *
 * Brand words (EdgeReco, Nimbus) and the bare repo-slug link text (edge-reco) stay
 * literal — they are not localized — while every surrounding sentence resolves from
 * the `common` i18n namespace.
 */
export function Footer() {
	const { t } = useTranslation("common");
	return (
		<footer className="nimbus-footer">
			<p className="nimbus-footer__line">
				<strong>EdgeReco</strong> {t("footer.thesis")}
			</p>
			<nav className="nimbus-footer__links" aria-label={t("footer.navLabel")}>
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-reco"
				>
					{t("footer.links.repo")}
				</a>
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-proc"
				>
					{t("footer.links.substrate")}
				</a>
				<a className="nimbus-footer__link" href="/edgeproc">
					{t("footer.links.whatIs")}
				</a>
				<a className="nimbus-footer__link" href="/faq">
					{t("footer.links.faq")}
				</a>
			</nav>
			<p className="nimbus-footer__line nimbus-footer__line--muted">
				{t("footer.demoBefore")}{" "}
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-reco"
				>
					edge-reco
				</a>{" "}
				{t("footer.demoAfter")}
			</p>
			<p className="nimbus-footer__line nimbus-footer__line--muted">
				{t("footer.attribution")}
			</p>
		</footer>
	);
}
