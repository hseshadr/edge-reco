import { expect, test } from "@playwright/test";

/**
 * THE airplane-mode proof. After one online sync the whole store works with the
 * network cut: the SW serves the shell + model, OPFS holds the bundle. Because
 * boot warms the embedder model before the Storefront mounts, a Storefront that
 * mounts OFFLINE is itself proof the model was served from cache.
 *
 * Flow (robust against the SW-not-yet-controlling race): launch online so the SW
 * installs + caches the shell + model and OPFS gets the bundle; reload online so
 * the SW is guaranteed to CONTROL the page (the first model fetch is then surely
 * intercepted and cached); then cut the network, reload, and relaunch — a mount
 * with zero network is the proof.
 */
const PRODUCT_CARD = "main article.card button.card__overlay";
const OFFLINE_BADGE = ".offline-badge";

async function launch(page: import("@playwright/test").Page): Promise<void> {
	await page.getByRole("button", { name: "▶ Launch the live demo" }).click();
	await expect(page.locator(PRODUCT_CARD).first()).toBeVisible({
		timeout: 240_000,
	});
}

test("storefront works fully offline after one online sync", async ({
	page,
	context,
}) => {
	// Surface anything that tries (and fails) to hit the network once offline —
	// the debug hook for the known model-cache risk.
	page.on("requestfailed", (request) => {
		console.log(`requestfailed: ${request.method()} ${request.url()}`);
	});

	// 1. Warm online: the SW installs + caches the shell and model; OPFS gets the bundle.
	await page.goto("/");
	await page.evaluate(() => navigator.serviceWorker.ready);
	await launch(page);

	// 2. Reload online so the SW DEFINITELY controls the page/worker — the model
	//    fetch on this launch is intercepted and persisted to the SW cache. This
	//    removes the first-load "activated-but-not-yet-controlling" race.
	await page.reload();
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		// Wait until this client is actually controlled, not merely until a SW is ready.
		if (!navigator.serviceWorker.controller) {
			await new Promise<void>((resolve) => {
				navigator.serviceWorker.addEventListener(
					"controllerchange",
					() => resolve(),
					{ once: true },
				);
			});
		}
	});
	await launch(page);

	// 3. Cut the network at the browser context.
	await context.setOffline(true);

	// 4. Reload. Shell ← SW precache, bundle ← OPFS, model ← SW cache. No network.
	await page.reload();
	await launch(page); // mounts offline ⇒ model + bundle + shell all served without network
	await expect(page.locator(OFFLINE_BADGE)).toBeVisible();
	await expect(page.locator("h2:text-is('Recommended for you')")).toBeVisible();

	await page.screenshot({ path: "test-results/offline.png", fullPage: true });
});
