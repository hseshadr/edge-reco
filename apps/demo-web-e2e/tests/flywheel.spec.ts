import { expect, test } from "@playwright/test";

test.describe("EdgeReco Phase 0 flywheel", () => {
  test("clicking running items promotes them in the rerank", async ({ page }) => {
    await page.goto("/");

    // Wait for initial load
    await expect(page.getByText("EdgeReco — Phase 0 Demo")).toBeVisible();
    await expect(page.locator(".candidate-card").first()).toBeVisible();

    // Reset profile for reproducibility
    await page.getByRole("button", { name: /reset profile/i }).click();
    // Wait for the grid to reload after reset
    await page.waitForTimeout(500);
    await expect(page.locator(".candidate-card").first()).toBeVisible();

    // Capture initial ordering
    const initialOrder = await page.locator(".candidate-card .title").allInnerTexts();

    // Click three running items by finding the card that contains the title
    const runningTitles = ["Trail Runner X", "Pace Sprint Max", "Cloud Stride Ultra"];
    for (const title of runningTitles) {
      const card = page.locator(`.candidate-card:has-text("${title}")`);
      await card.getByRole("button", { name: /^Click$/i }).click();
      // Wait for rerank to complete
      await page.waitForTimeout(300);
    }

    // After clicks, session click count should be 3
    await expect(page.getByText(/clicks this session: 3/i)).toBeVisible();

    // The order should have changed (running items moved up)
    const newOrder = await page.locator(".candidate-card .title").allInnerTexts();
    expect(newOrder).not.toEqual(initialOrder);

    // The top category in the profile panel should be "running"
    const firstCategory = page.locator(".profile-panel .cat").first();
    await expect(firstCategory).toHaveText("running");

    // Reload and verify profile persists
    await page.reload();
    await expect(page.locator(".candidate-card").first()).toBeVisible();

    // Category affinity should still show running at the top
    await expect(page.locator(".profile-panel .cat").first()).toHaveText("running");
  });
});
