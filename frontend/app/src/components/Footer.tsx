/**
 * Small, always-visible site footer. States plainly that Nimbus is a fictional
 * demo store and credits the catalog data source — so nobody mistakes it for a
 * real shop or unattributed data.
 */
export function Footer() {
	return (
		<footer className="nimbus-footer">
			<p className="nimbus-footer__line">
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
