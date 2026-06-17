import { test, expect, devices } from "@playwright/test";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);
test.use({ viewport: devices["iPhone 13"].viewport });

// §6: <768px placing must lock a no-scroll layout — clock always visible,
// hand rail pinned to the bottom, TopBar trimmed down, turn/timer visible.
test("placing locks a mobile layout under 768px: trimmed TopBar, clock + hand + timer all visible", async ({ browser }) => {
  const { pageA } = await setupTwoPlayersInPlacing(browser);

  await expect(pageA.locator(".topbar__brand")).toBeHidden();
  await expect(pageA.locator(".topbar__seats")).toBeHidden();

  const viewportHeight = pageA.viewportSize()!.height;

  const clockBox = await pageA.locator(".clock-board").boundingBox();
  expect(clockBox).not.toBeNull();
  expect(clockBox!.y).toBeGreaterThanOrEqual(0);
  expect(clockBox!.y + clockBox!.height).toBeLessThanOrEqual(viewportHeight);

  const handBox = await pageA.locator(".hand-rail").boundingBox();
  expect(handBox).not.toBeNull();
  expect(handBox!.y + handBox!.height).toBeLessThanOrEqual(viewportHeight + 1);

  await expect(pageA.locator(".placing__big-timer")).toBeVisible();
});
