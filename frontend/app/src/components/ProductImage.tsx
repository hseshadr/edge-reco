import { useState } from "react";
import type { Product } from "../api/types";

interface CategoryStyle {
	className: string;
	glyph: string;
	label: string;
}

const CATEGORY_STYLES: Record<string, CategoryStyle> = {
	electronics: {
		className: "pimg-tile--electronics",
		glyph: "\u{1F50C}",
		label: "Electronics",
	},
	clothing: {
		className: "pimg-tile--clothing",
		glyph: "\u{1F9E5}",
		label: "Clothing",
	},
	"home & kitchen": {
		className: "pimg-tile--home",
		glyph: "\u{1FAB4}",
		label: "Home & Kitchen",
	},
	sports: {
		className: "pimg-tile--sports",
		glyph: "\u{26BD}",
		label: "Sports",
	},
	books: {
		className: "pimg-tile--books",
		glyph: "\u{1F4DA}",
		label: "Books",
	},
};

const DEFAULT_STYLE: CategoryStyle = {
	className: "pimg-tile--default",
	glyph: "\u{2728}",
	label: "Catalog",
};
const LOCAL_ASSET_ORIGIN = "https://edge-reco.invalid";

function styleFor(category: string): CategoryStyle {
	return CATEGORY_STYLES[category.trim().toLowerCase()] ?? DEFAULT_STYLE;
}

/** Only release-owned root-relative assets may leave the placeholder boundary. */
function isLocalImage(url: string): boolean {
	if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) {
		return false;
	}
	try {
		return new URL(url, LOCAL_ASSET_ORIGIN).origin === LOCAL_ASSET_ORIGIN;
	} catch {
		return false;
	}
}

interface ProductImageProps {
	product: Product;
}

export function ProductImage({ product }: ProductImageProps) {
	const [broken, setBroken] = useState(false);
	const imageUrl = product.image_url.trim();
	const hasImage = isLocalImage(imageUrl) && !broken;

	if (hasImage) {
		return (
			<img
				className="pimg"
				src={imageUrl}
				alt={product.title}
				loading="lazy"
				onError={() => setBroken(true)}
			/>
		);
	}

	const style = styleFor(product.category);
	return (
		<div className={`pimg-tile ${style.className}`} aria-hidden="true">
			<span className="pimg-tile__cat">{style.label}</span>
			<span className="pimg-tile__glyph">{style.glyph}</span>
			<span className="pimg-tile__title">{product.title}</span>
		</div>
	);
}
