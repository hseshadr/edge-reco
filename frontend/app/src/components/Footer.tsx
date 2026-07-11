/**
 * Small, always-visible site footer. Anchors the site's internal links: it states
 * plainly that EdgeReco is open source and runs on-device, points at the GitHub
 * repos and the entity pages (/edgeproc, /faq) so both shoppers and crawlers can
 * follow the link graph, and keeps the honest disclaimers (Nimbus is a fictional
 * demo store; the catalog data is attributed).
 */
export function Footer() {
	return (
		<footer className="nimbus-footer">
			<p className="nimbus-footer__line">
				<strong>EdgeReco</strong> by hseshadr is open source — and runs on your
				device. Search, ranking, and recommendations execute right in this
				browser tab, with no per-query backend.
			</p>
			<nav className="nimbus-footer__links" aria-label="EdgeReco">
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-reco"
				>
					EdgeReco on GitHub
				</a>
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-proc"
				>
					EdgeProc substrate
				</a>
				<a className="nimbus-footer__link" href="/edgeproc">
					What is EdgeProc?
				</a>
				<a className="nimbus-footer__link" href="/faq">
					FAQ
				</a>
			</nav>
			<p className="nimbus-footer__line nimbus-footer__line--muted">
				Nimbus is a fictional demo store built to showcase{" "}
				<a
					className="nimbus-footer__link"
					href="https://github.com/hseshadr/edge-reco"
				>
					edge-reco
				</a>{" "}
				— its entire search-and-recommend brain runs in this browser tab.
			</p>
			<p className="nimbus-footer__line nimbus-footer__line--muted">
				Product data: Amazon E-commerce Products &amp; Reviews Dataset (Kaggle,
				MIT). See the repo&rsquo;s NOTICE for attribution.
			</p>
		</footer>
	);
}
