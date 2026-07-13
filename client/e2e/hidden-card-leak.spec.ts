import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

// Mirrors the server-side visibility masking (see AGENTS.md) on the client:
// blind cards may render color, but must never render a value in text or in any DOM attribute.
test("blind hand cards and unrevealed placed cards never leak their value into the DOM", async ({ browser }) => {
  const { pageA } = await setupTwoPlayersInPlacing(browser);

  const handCards = pageA.locator(".hand-rail .hand-card");
  await expect(handCards).toHaveCount(6);

  // 2-player deal: first and last of the 6 hand cards start blind to their owner.
  const firstBlind = handCards.nth(0);
  const lastBlind = handCards.nth(5);
  await expect(firstBlind).toHaveAttribute("aria-label", "盲牌");
  await expect(lastBlind).toHaveAttribute("aria-label", "盲牌");

  for (const blind of [firstBlind, lastBlind]) {
    const html = await blind.evaluate((el) => el.outerHTML);
    expect(html).not.toMatch(/[0-9]/);
  }

  await firstBlind.click();
  await pageA.locator('[data-segment="0"]').click();

  const placedBlind = pageA.locator('[data-segment="0"] .placed-card--blind');
  await expect(placedBlind).toBeVisible();
  const placedHtml = await placedBlind.evaluate((el) => el.outerHTML);
  expect(placedHtml).not.toMatch(/[0-9]/);
});
