import { expect, test } from "@playwright/test";

/**
 * The Nimbus storefront hero loop — proven FULLY BACKEND-FREE in a real browser.
 *
 * NO application backend runs. The only servers are a static SPA (Vite) and a
 * dumb static file origin for the signed bundle (catalog-server.mjs). The test
 * asserts the whole in-tab pipeline:
 *
 *   boot screen → sync the signed bundle into OPFS (real ed25519 + sha256 +
 *   content-addressed chunks, in a Worker) → storefront mounts over the real
 *   720-product Amazon catalog → search embeds a query in-tab and returns real
 *   products → clicking 3 products folds into the in-tab session profile (NO
 *   network) → the "Recommended for you" rail re-ranks and the session badge
 *   increments → "why?" reveals the score bars.
 *
 * REAL vs STUBBED:
 *   - REAL: the sync engine (OPFS, signature + chunk verification, reassembly of
 *     the 720-product catalog), the BM25 ⊕ vector → RRF → session-rerank search
 *     engine, and the in-tab session profile / click→re-rank loop.
 *   - STUBBED: only the embedder TRANSPORT. The demo's
 *     `window.__edgeprocDemoTestHooks.makeEmbedder` factory returns a
 *     deterministic 384-d-vector embedder so the test does not wait on the
 *     ~25 MB transformers.js model download (the single slow/flaky external
 *     fetch). The vector leg still runs against the real index; BM25 keyword
 *     matching drives query-specific search. Everything else is the production
 *     path.
 *   - Product images (m.media-amazon.com) are blocked so the run is offline +
 *     deterministic; the cards fall back to their gradient tiles.
 */

const RAIL = "aside[aria-label='Recommended for you']";
// The card root became an <article> in v0.9.0; the full-card action is the
// overlay button (one per card, so counting overlays counts cards).
const PRODUCT_CARD = "main article.card button.card__overlay";
const RAIL_ITEM = `${RAIL} li.rail-card`;
const RAIL_TITLE = `${RAIL} .rail-card__title`;

const EMBEDDING_DIM = 384;

test.beforeEach(async ({ page }) => {
	// Install a deterministic embedder factory BEFORE any app script runs, via
	// the demo's narrow test hook. createDataClient() picks it up instead of
	// loading the real ~25 MB model. The hook lives in the demo (not in the
	// engine package) and is the ONLY non-production seam this test relies on.
	await page.addInitScript((dim: number) => {
		const seedVec = (text: string): Float32Array => {
			const v = new Float32Array(dim);
			let h = 2166136261;
			for (let i = 0; i < text.length; i += 1) {
				h = Math.imul(h ^ text.charCodeAt(i), 16777619);
			}
			for (let i = 0; i < dim; i += 1) {
				v[i] = (((h >>> (i % 31)) & 0xff) / 255 - 0.5) * (i === 0 ? 2 : 1);
			}
			return v;
		};
		(
			globalThis as {
				__edgeprocDemoTestHooks?: {
					makeEmbedder?: () => {
						embed: (text: string) => Promise<Float32Array>;
					};
				};
			}
		).__edgeprocDemoTestHooks = {
			makeEmbedder: () => ({
				embed: (text: string) => Promise.resolve(seedVec(text)),
			}),
		};
	}, EMBEDDING_DIM);

	// Block external product images: keeps the run offline + deterministic and
	// forces the gradient-tile fallback. (Not part of the engine under test.)
	await page.route(/m\.media-amazon\.com/, (route) => route.abort());
});

test("backend-free hero loop: sync → search → 3 clicks re-rank the rail → 'why?' reveals bars", async ({
	page,
}) => {
	await page.goto("/");

	// --- Launch gate: the Landing shows first; the engine stays cold until the
	// user clicks Launch. Cross the gate before expecting the boot/store. ---
	await page.getByRole("button", { name: "▶ Launch the live demo" }).click();

	// --- Boot: the signed bundle syncs in-tab and the storefront mounts ---
	// The boot screen steps through real stages; once ready the grid populates.
	// A generous timeout covers sync + 720-product index reassembly.
	const productCards = page.locator(PRODUCT_CARD);
	await expect(productCards.first()).toBeVisible({ timeout: 60_000 });
	expect(await productCards.count()).toBeGreaterThanOrEqual(3);

	const railItems = page.locator(RAIL_ITEM);
	await expect(railItems.first()).toBeVisible();
	expect(await railItems.count()).toBeGreaterThanOrEqual(1);

	const badge = page.locator(`${RAIL} .clicks-badge`);
	await expect(badge).toHaveText("0");

	// --- Search runs in-tab over the synced index and returns real products ---
	const searchBox = page.getByRole("searchbox", { name: "Search products" });
	await searchBox.fill("shirt");
	await expect
		.poll(() => productCards.count(), {
			message: "in-tab search should return at least one result",
			timeout: 15_000,
		})
		.toBeGreaterThanOrEqual(1);
	// Back to the browse grid for the click loop.
	await searchBox.fill("");
	await expect(productCards.first()).toBeVisible();

	const railTitles = page.locator(RAIL_TITLE);
	const initialTitleSet = (await railTitles.allTextContents())
		.map((t) => t.trim())
		.join(" | ");

	// --- Click 3 products; each click folds into the IN-TAB session profile ---
	// Composition-agnostic: the catalog is dominated by one category, so any 3
	// clicks build affinity and re-rank the rail. The badge is the authoritative
	// in-tab click counter (no network acknowledges it — it is local state).
	for (let i = 0; i < 3; i++) {
		await productCards.nth(i).click();
		await expect(badge).toHaveText(String(i + 1));
	}

	// --- Rail re-ranked from the clicks, entirely in-tab (no backend) ---
	await expect(badge).toHaveText("3");
	await expect
		.poll(
			async () =>
				(await railTitles.allTextContents()).map((t) => t.trim()).join(" | "),
			{ message: "rail should re-rank after 3 clicks (no backend)" },
		)
		.not.toBe(initialTitleSet);

	// --- "why?" reveals the engine's score bars for the top pick ---
	const topRailCard = railItems.first();
	const whyBtn = topRailCard.getByRole("button", { name: "why?" });
	await expect(whyBtn).toBeVisible();
	await whyBtn.click();
	const scoreBars = topRailCard.locator(".why__bar");
	await expect(scoreBars.first()).toBeVisible();
	expect(await scoreBars.count()).toBeGreaterThanOrEqual(1);
	await expect(topRailCard.getByText("Why this ranks here")).toBeVisible();

	// --- Graded signals (v0.9.0): favorite and cart are explicit signals too ---
	const firstCardActions = page
		.locator("main article.card")
		.first()
		.locator(".card__actions button");
	const toast = page.locator(".toast[role='status']");

	await firstCardActions.nth(0).click(); // favorite
	await expect(badge).toHaveText("4"); // explicit-signal badge: 3 clicks + 1 favorite
	await expect(firstCardActions.nth(0)).toHaveAttribute("aria-pressed", "true");
	await expect(toast).toContainText("strong signal");

	await firstCardActions.nth(1).click(); // add to cart
	await expect(badge).toHaveText("5");
	await expect(page.locator(".cart-pill")).toHaveText(/1/);
	await expect(toast).toContainText("nothing is purchased"); // first-add honesty

	// --- Capture the personalized, backend-free state ---
	// Write to the gitignored test-results/ dir so the run never dirties the
	// committed docs/storefront.png asset that the README references.
	await page.screenshot({
		path: "test-results/storefront.png",
		fullPage: true,
	});
});

test("a single cart-add alone visibly re-ranks the rail", async ({ page }) => {
	// The cart-vs-clicks magnitude claim (cart out-weighs two clicks on every
	// affinity facet) is pinned deterministically against the real engine fold
	// in src/signals/gradedSignals.test.ts. Here we prove the visible half:
	// ONE cart-add re-orders the rail on its own — the hero loop needs three
	// clicks. Set-stability is expected (the settled, category-saturated pool
	// keeps the same strong candidates); the RANKING is what must move.
	await page.goto("/");
	await page.getByRole("button", { name: "▶ Launch the live demo" }).click();
	await expect(page.locator(PRODUCT_CARD).first()).toBeVisible({
		timeout: 60_000,
	});
	// Let the initial viewport's ambient dwell views fire (2 s window) and the
	// rail settle, so the baseline is stable before the cart signal lands.
	await page.waitForTimeout(2_600);
	const before = (await page.locator(RAIL_TITLE).allTextContents()).map((t) =>
		t.trim(),
	);

	await page
		.locator("main article.card")
		.first()
		.locator(".card__actions button")
		.nth(1)
		.click();
	await expect(page.locator(`${RAIL} .clicks-badge`)).toHaveText("1");
	const after = (await page.locator(RAIL_TITLE).allTextContents()).map((t) =>
		t.trim(),
	);

	const movedPositions = before.filter((t, i) => after[i] !== t).length;
	expect(movedPositions).toBeGreaterThanOrEqual(1);
});
