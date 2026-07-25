import { useState } from "react";
import type { Product } from "../api/types";
import { styleForCategory, toneClassFor } from "./categoryStyle";

const LOCAL_ASSET_ORIGIN = "https://edge-reco.invalid";

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

	const style = styleForCategory(product.category);
	const tone = toneClassFor(product.id);
	const toneSuffix = tone === "" ? "" : ` ${tone}`;
	return (
		<div
			className={`pimg-tile ${style.className}${toneSuffix}`}
			aria-hidden="true"
		>
			<span className="pimg-tile__cat">{style.label}</span>
			<span className="pimg-tile__glyph">{style.glyph}</span>
			<span className="pimg-tile__title">{product.title}</span>
		</div>
	);
}
