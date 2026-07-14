import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import type { Product } from "../api/types";
import { formatPrice } from "../format";
import { ProductImage } from "./ProductImage";

interface ProductCardProps {
	product: Product;
	index: number;
	onPick: (product: Product) => void;
	onFavorite: (product: Product) => void;
	onAddToCart: (product: Product) => void;
	favorited: boolean;
	dwellRef: (el: HTMLElement | null) => void;
}

/**
 * One catalog card. The root is an <article> (NOT a button) because the card
 * hosts three distinct actions — the full-card "add to taste" overlay button
 * plus the favorite/cart signal buttons layered above it; nested buttons are
 * invalid HTML and break keyboard a11y. `dwellRef` is the ambient dwell-view
 * observer's hook onto the card root.
 */
export function ProductCard({
	product,
	index,
	onPick,
	onFavorite,
	onAddToCart,
	favorited,
	dwellRef,
}: ProductCardProps) {
	const { t } = useTranslation("storefront");
	return (
		<motion.article
			className="card"
			ref={dwellRef}
			initial={{ opacity: 0, y: 18 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{
				duration: 0.45,
				delay: Math.min(index * 0.04, 0.6),
				ease: [0.22, 1, 0.36, 1],
			}}
			whileHover={{ y: -6, boxShadow: "var(--shadow-lift)" }}
		>
			<button
				type="button"
				className="card__overlay"
				aria-label={t("card.addToTasteAria", { title: product.title })}
				onClick={() => onPick(product)}
			/>
			<div className="card__actions">
				<button
					type="button"
					className={
						favorited ? "card__action card__action--active" : "card__action"
					}
					aria-pressed={favorited}
					aria-label={
						favorited
							? t("card.unfavoriteAria", { title: product.title })
							: t("card.favoriteAria", { title: product.title })
					}
					onClick={() => onFavorite(product)}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill={favorited ? "currentColor" : "none"}
						aria-hidden="true"
					>
						<path
							d="M12 20.3 4.7 13a4.9 4.9 0 0 1 0-7 4.9 4.9 0 0 1 7 0l.3.4.3-.4a4.9 4.9 0 0 1 7 0 4.9 4.9 0 0 1 0 7L12 20.3z"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinejoin="round"
						/>
					</svg>
				</button>
				<button
					type="button"
					className="card__action"
					aria-label={t("card.addToCartAria", { title: product.title })}
					onClick={() => onAddToCart(product)}
				>
					<svg
						width="15"
						height="15"
						viewBox="0 0 24 24"
						fill="none"
						aria-hidden="true"
					>
						<path
							d="M3 4h2.4l2.3 11.2a1.6 1.6 0 0 0 1.6 1.3h7.6a1.6 1.6 0 0 0 1.6-1.2L20.5 8H6"
							stroke="currentColor"
							strokeWidth="2"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
						<circle cx="10" cy="20" r="1.4" fill="currentColor" />
						<circle cx="17" cy="20" r="1.4" fill="currentColor" />
					</svg>
				</button>
			</div>
			<div className="card__media">
				<div className="card__zoom" style={{ position: "absolute", inset: 0 }}>
					<ProductImage product={product} />
				</div>
			</div>
			<div className="card__body">
				{product.brand.trim() !== "" && (
					<span className="card__brand">{product.brand}</span>
				)}
				<span className="card__title">{product.title}</span>
				<div className="card__foot">
					<span className="card__price">
						{formatPrice(product.price, product.currency)}
					</span>
					<span className="card__pick">{t("card.addToTaste")}</span>
				</div>
			</div>
		</motion.article>
	);
}
