import { useTranslation } from "react-i18next";
import type { Product, SearchResult } from "../api/types";
import { formatPrice } from "../format";
import { ProductImage } from "./ProductImage";
import { RailRow } from "./RailRow";

/** A PDP rail: its display label and the results it should show. */
export interface PdpRail {
	readonly key: string;
	readonly label: string;
	readonly results: SearchResult[];
}

interface ProductDetailProps {
	product: Product;
	rails: PdpRail[];
	onBack: () => void;
	onPick: (product: Product) => void;
}

/**
 * The product-detail view (state-based, no router — so reloads never 404 on
 * GitHub Pages). Shows the viewed product plus its strategy rails (Similar
 * items / Because you viewed this / Trending in {category}). Any rail that came
 * back empty — e.g. a vector rail that threw and was caught upstream — is
 * dropped here, so a missing rail never leaves an empty shell or crashes.
 */
export function ProductDetail({
	product,
	rails,
	onBack,
	onPick,
}: ProductDetailProps) {
	const { t } = useTranslation("storefront");
	const visibleRails = rails.filter((rail) => rail.results.length > 0);

	return (
		<div className="pdp">
			<button type="button" className="pdp__back" onClick={onBack}>
				{t("pdp.back")}
			</button>

			<article className="pdp__hero" aria-label={product.title}>
				<div className="pdp__media">
					<ProductImage product={product} />
				</div>
				<div className="pdp__info">
					{product.brand.trim() !== "" && (
						<span className="pdp__brand">{product.brand}</span>
					)}
					<h1 className="pdp__title">{product.title}</h1>
					<div className="pdp__price">
						{formatPrice(product.price, product.currency)}
					</div>
					{product.description.trim() !== "" && (
						<p className="pdp__desc">{product.description}</p>
					)}
					<div className="pdp__cat">{product.category}</div>
				</div>
			</article>

			<div className="rail-stack">
				{visibleRails.map((rail) => (
					<RailRow
						key={rail.key}
						railId={rail.key}
						label={rail.label}
						results={rail.results}
						onPick={onPick}
						tagline={t("rail.taglineDefault")}
					/>
				))}
			</div>
		</div>
	);
}
