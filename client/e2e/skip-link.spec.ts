import { test, expect } from "./fixtures.js";
import { resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// frontend-code-review-2026-06-16.md P2#12: keyboard/AT users had no way to
// jump past the always-present TopBar straight to the page's main content.
test("first Tab from page load focuses a skip link that jumps to #main-content", async ({ page }) => {
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.locator(".skip-link");
  await expect(skipLink).toBeFocused();
  await expect(skipLink).toHaveAttribute("href", "#main-content");

  await expect(page.locator("#main-content")).toHaveCount(1);
});
