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

/**
 * Hosts a REMOTE-mode build is allowed to load product photos from.
 *
 * Empty in the default LOCAL mode, so the egress boundary above is the only rule and
 * a page load makes zero third-party requests. A remote-mode build injects the exact
 * host list the deployed `img-src` names (one source of truth: `scripts/imageCsp.mjs`),
 * because permitting the host in CSP is useless while the component still refuses the
 * url — that mismatch renders every card as a placeholder.
 */
const BUILD_REMOTE_HOSTS: readonly string[] = (
	import.meta.env.VITE_REMOTE_IMAGE_HOSTS ?? ""
)
	.split(/\s+/u)
	.filter((host: string) => host.length > 0);

/** Exact-origin match against the allowlist — never a suffix test. */
function isAllowedRemoteImage(
	url: string,
	allowed: readonly string[],
): boolean {
	if (allowed.length === 0) {
		return false;
	}
	try {
		const parsed = new URL(url);
		// `origin` pins scheme + host + port, so `m.media-amazon.com.attacker.test`
		// and an http:// downgrade both fail where an `endsWith` check would pass.
		return parsed.protocol === "https:" && allowed.includes(parsed.origin);
	} catch {
		return false;
	}
}

interface ProductImageProps {
	product: Product;
	/** Overrides the build-time allowlist; tests drive both modes through this. */
	allowedRemoteHosts?: readonly string[];
}

export function ProductImage({
	product,
	allowedRemoteHosts = BUILD_REMOTE_HOSTS,
}: ProductImageProps) {
	const [broken, setBroken] = useState(false);
	const imageUrl = product.image_url.trim();
	const renderable =
		isLocalImage(imageUrl) ||
		isAllowedRemoteImage(imageUrl, allowedRemoteHosts);
	const hasImage = renderable && !broken;

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
