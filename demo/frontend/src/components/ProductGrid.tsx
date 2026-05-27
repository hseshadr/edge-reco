import type { Product } from "../api/types";
import { ProductCard } from "./ProductCard";

const SKELETON_KEYS = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"];

interface ProductGridProps {
	products: Product[];
	kicker: string;
	title: string;
	loading: boolean;
	onPick: (product: Product) => void;
}

function SkeletonCard() {
	return (
		<div className="skeleton">
			<div className="skeleton__media" />
			<div className="skeleton__line" />
			<div className="skeleton__line skeleton__line--short" />
		</div>
	);
}

export function ProductGrid({
	products,
	kicker,
	title,
	loading,
	onPick,
}: ProductGridProps) {
	return (
		<section aria-label={title}>
			<div className="section-head">
				<div>
					<div className="section-head__kicker">{kicker}</div>
					<h2 className="section-head__title">{title}</h2>
				</div>
				{!loading && (
					<span className="section-head__count">
						{products.length} item{products.length === 1 ? "" : "s"}
					</span>
				)}
			</div>

			{loading ? (
				<div className="grid">
					{SKELETON_KEYS.map((key) => (
						<SkeletonCard key={key} />
					))}
				</div>
			) : products.length === 0 ? (
				<p className="empty">
					Nothing here yet. Try another search or category.
				</p>
			) : (
				<div className="grid">
					{products.map((product, index) => (
						<ProductCard
							key={product.id}
							product={product}
							index={index}
							onPick={onPick}
						/>
					))}
				</div>
			)}
		</section>
	);
}
