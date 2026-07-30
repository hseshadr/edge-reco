import { expect, test } from "@playwright/test";

/**
 * Product cards must render a REAL, VISIBLE image under the PRODUCTION CSP.
 *
 * The storefront's images are only as good as three things holding together at
 * once, and a unit test can see none of them:
 *
 *   1. the published bundle points `image_url` at a root-relative card
 *      (`/images/<id>.svg`) — a third-party CDN url makes `ProductImage` render
 *      the placeholder tile and never an `<img>` at all;
 *   2. that card is actually SERVED at that path by the static origin;
 *   3. production's `img-src 'self' data:` permits it — an off-origin url would
 *      be blocked by the browser even if 1 and 2 somehow held.
 *
 * WHY THIS LANE: only the offline/preview config runs the PRODUCTION build, and
 * `previewProdCspPlugin` now makes preview serve the REAL production CSP, so this
 * is the only place all three are observable together. Asserting `naturalWidth > 0`
 * — not merely that an `<img>` exists — is what makes this measure the PROPERTY
 * (a pixel the shopper can see) rather than its shape (a tag in the DOM).
 */

const PRODUCT_CARD = "main article.card button.card__overlay";
const CARD_IMAGE = "main article.card img.pimg";

/** Cross the launch gate and wait for the storefront to mount (real model). */
async function launch(page: import("@playwright/test").Page): Promise<void> {
	await page.goto("/");
	await page.getByRole("button", { name: "▶ Launch the live demo" }).click();
	await expect(page.locator(PRODUCT_CARD).first()).toBeVisible({
		timeout: 240_000,
	});
}

test("a product card renders a visible image under the production CSP", async ({
	page,
}) => {
	test.setTimeout(300_000);

	// Any image the production policy would block must surface here, not on the
	// live site. Installed before navigation so nothing is missed during boot.
	await page.addInitScript(() => {
		(window as unknown as { __cspViolations: string[] }).__cspViolations = [];
		addEventListener("securitypolicyviolation", (event) => {
			(window as unknown as { __cspViolations: string[] }).__cspViolations.push(
				`${event.effectiveDirective} ${event.blockedURI}`,
			);
		});
	});

	// GUARD THE GUARD: if preview ever stops serving the production CSP this spec
	// would silently degrade into a no-CSP test that can no longer fail.
	const response = await page.goto("/");
	expect(
		response?.headers()["content-security-policy"],
		"vite preview must serve the production CSP (previewProdCspPlugin)",
	).toContain("img-src 'self' data:");

	await launch(page);

	const image = page.locator(CARD_IMAGE).first();

	// `ProductImage` renders NO <img> at all for an off-origin url — it falls back
	// to the placeholder tile. So a missing element is the exact shape of the bug,
	// and it is asserted first, with its own short timeout, to fail fast and say why.
	await expect(
		image,
		"a product card must render an <img>; a bundle whose image_url is an off-origin " +
			"CDN url makes ProductImage fall back to the placeholder tile instead",
	).toBeAttached({ timeout: 30_000 });
	await image.scrollIntoViewIfNeeded();

	// (1) The bundle points at a release-owned, root-relative card...
	const src = await image.getAttribute("src");
	expect(
		src,
		"the bundle must localize image_url to a root-relative card",
	).toMatch(/^\/images\/[A-Za-z0-9._-]+\.svg$/u);

	// (2)+(3) ...and the browser actually decoded pixels from it. `naturalWidth`
	// is 0 for a 404, a blocked request, or an undecodable body — so this single
	// assertion covers "served" and "permitted by CSP" together.
	await expect
		.poll(() => image.evaluate((node: HTMLImageElement) => node.naturalWidth), {
			message: "the product card image must decode to real pixels",
			timeout: 30_000,
		})
		.toBeGreaterThan(0);

	await expect(image).toBeVisible();

	const blocked = await page.evaluate(
		() => (window as unknown as { __cspViolations: string[] }).__cspViolations,
	);
	expect(
		blocked.join(" | "),
		"no resource may be blocked by the production CSP",
	).toBe("");

	await page.screenshot({
		path: "test-results/product-images.png",
		fullPage: false,
	});
});
