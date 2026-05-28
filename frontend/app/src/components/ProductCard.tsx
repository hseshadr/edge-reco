import { motion } from "motion/react";
import type { Product } from "../api/types";
import { formatPrice } from "../format";
import { ProductImage } from "./ProductImage";

interface ProductCardProps {
	product: Product;
	index: number;
	onPick: (product: Product) => void;
}

export function ProductCard({ product, index, onPick }: ProductCardProps) {
	return (
		<motion.button
			type="button"
			className="card"
			onClick={() => onPick(product)}
			initial={{ opacity: 0, y: 18 }}
			animate={{ opacity: 1, y: 0 }}
			transition={{
				duration: 0.45,
				delay: Math.min(index * 0.04, 0.6),
				ease: [0.22, 1, 0.36, 1],
			}}
			whileHover={{ y: -6, boxShadow: "var(--shadow-lift)" }}
		>
			<div className="card__media">
				<motion.div
					style={{ position: "absolute", inset: 0 }}
					whileHover={{ scale: 1.06 }}
					transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
				>
					<ProductImage product={product} />
				</motion.div>
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
					<span className="card__pick">Add to taste &rarr;</span>
				</div>
			</div>
		</motion.button>
	);
}
