import { test, expect } from "@playwright/test";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// frontend-code-review-2026-06-16.md P1#4: Pill is a segmented single-select
// control — keyboard users should be able to move the selection with arrow
// keys (roving tabindex), not just Tab to each button individually.
test("host can move hint-marker Pill selection with the right arrow key", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await joinAndReady(pageA, "Alice");
  await expect(pageA.locator(".lobby")).toBeVisible();

  const group = pageA.getByRole("group", { name: "提示标记数量" });
  const twoBtn   = group.getByRole("button", { name: "2 个" });
  const threeBtn = group.getByRole("button", { name: "3 个" });

  // Room settings are sticky host preferences (not reset between rounds),
  // so don't assume a starting value — click a known option first.
  await twoBtn.click();
  await expect(twoBtn).toHaveAttribute("aria-pressed", "true");

  await twoBtn.focus();
  await pageA.keyboard.press("ArrowRight");

  await expect(threeBtn).toBeFocused();
  await expect(threeBtn).toHaveAttribute("aria-pressed", "true");
  await expect(twoBtn).toHaveAttribute("aria-pressed", "false");
});
