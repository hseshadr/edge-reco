import { expect, test } from "@playwright/test";

/**
 * The Nimbus storefront hero loop.
 *
 * Clicking a product card fires `POST /events` then refetches `/recommend`,
 * so the "Recommended for you" rail re-ranks toward the clicked category and
 * the session badge increments. This test drives that loop end to end against
 * the live backend, asserts the rail re-ranked toward Electronics, opens a
 * rail card's "why?" panel to reveal the score-component bars, and captures a
 * full-page screenshot of the personalized state.
 *
 * Robustness: every wait is an `expect(...).toHave...` / `toBeVisible` retry on
 * a real signal (card count, badge text, rail title set, bar visibility) — no
 * fixed sleeps — so network latency and Motion layout animations settle
 * naturally before assertions run.
 */

const RAIL = "aside[aria-label='Recommended for you']";
const PRODUCT_CARD = "main button.card";
const RAIL_ITEM = `${RAIL} li.rail-card`;
const RAIL_TITLE = `${RAIL} .rail-card__title`;

test("hero loop: 3 Electronics clicks re-rank the rail and 'why?' reveals score bars", async ({
	page,
}) => {
	await page.goto("/");

	// --- Initial state: grid populated, rail populated, fresh session ---
	const productCards = page.locator(PRODUCT_CARD);
	await expect(productCards.first()).toBeVisible();
	expect(await productCards.count()).toBeGreaterThanOrEqual(1);

	const railItems = page.locator(RAIL_ITEM);
	await expect(railItems.first()).toBeVisible();
	expect(await railItems.count()).toBeGreaterThanOrEqual(1);

	const badge = page.locator(`${RAIL} .clicks-badge`);
	await expect(badge).toHaveText("0");

	const railTitles = page.locator(RAIL_TITLE);
	const initialTopTitle =
		(await railTitles.first().textContent())?.trim() ?? "";
	const initialTitleSet = (await railTitles.allTextContents())
		.map((t) => t.trim())
		.join(" | ");
	expect(initialTopTitle.length).toBeGreaterThan(0);

	// --- Click 3 Electronics product cards ---
	// Cards render their category as text ("Electronics") inside the image tile,
	// alongside the "Add to taste →" affordance. Pick the first three.
	const electronicsCards = page
		.locator(PRODUCT_CARD)
		.filter({ hasText: "Electronics" });
	await expect(electronicsCards.first()).toBeVisible();
	expect(await electronicsCards.count()).toBeGreaterThanOrEqual(3);

	for (let i = 0; i < 3; i++) {
		// Re-resolve each iteration; the grid itself does not change on click,
		// but resolving fresh avoids any stale-handle risk.
		await page
			.locator(PRODUCT_CARD)
			.filter({ hasText: "Electronics" })
			.nth(i)
			.click();
		// Wait for this click's signal to land before firing the next: the badge
		// is the authoritative server-acknowledged counter.
		await expect(badge).toHaveText(String(i + 1));
	}

	// --- Badge incremented to 3, rail re-ranked toward Electronics ---
	await expect(badge).toHaveText("3");

	// Rail re-ranked: the ordered set of titles changed from the cold-start rail.
	await expect
		.poll(
			async () =>
				(await railTitles.allTextContents()).map((t) => t.trim()).join(" | "),
			{ message: "rail should re-rank after 3 Electronics clicks" },
		)
		.not.toBe(initialTitleSet);

	// And the strongest signal: an Electronics-category item now sits at rank #1.
	// The rail card's image tile carries the category label, so the #1 card's
	// text contains "Electronics".
	await expect(railItems.first()).toContainText("Electronics");

	// --- Open the top rail card's "why?" panel; score bars become visible ---
	const topRailCard = railItems.first();
	const whyBtn = topRailCard.getByRole("button", { name: "why?" });
	await expect(whyBtn).toBeVisible();
	await whyBtn.click();

	// The explanation panel animates open (height auto); its score-component
	// bars become visible once expanded.
	const scoreBars = topRailCard.locator(".why__bar");
	await expect(scoreBars.first()).toBeVisible();
	expect(await scoreBars.count()).toBeGreaterThanOrEqual(1);
	// The "Why this ranks here" heading confirms the explanation rendered.
	await expect(topRailCard.getByText("Why this ranks here")).toBeVisible();

	// --- Capture the personalized state ---
	// Resolved from demo/frontend, so "../docs/storefront.png" lands at
	// demo/docs/storefront.png.
	await page.screenshot({ path: "../docs/storefront.png", fullPage: true });
});
