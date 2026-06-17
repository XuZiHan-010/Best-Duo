import { test, expect } from "@playwright/test";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

test("simultaneous card:place during the race window only lets the first attempt through", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  await Promise.all([
    pageA.locator(".hand-rail .hand-card").first().click(),
    pageB.locator(".hand-rail .hand-card").first().click(),
  ]);

  // The race loser's target segment is empty and unmounts the instant the
  // server reply marks the board non-interactive — a normal Playwright
  // .click() can lose the race against that re-render and throw on a
  // detached element. Dispatch the click natively instead.
  await Promise.all([
    pageA.locator('[data-segment="1"]').evaluate((el) => (el as HTMLElement).click()),
    pageB.locator('[data-segment="2"]').evaluate((el) => (el as HTMLElement).click()),
  ]);

  // Shared room state — both ends must agree exactly one card landed.
  await expect(pageA.locator(".placed-card")).toHaveCount(1);
  await expect(pageB.locator(".placed-card")).toHaveCount(1);

  // The winner is the only one asked to decide the hint for their own card.
  const aWon = await pageA.locator(".hint-prompt").isVisible();
  const bWon = await pageB.locator(".hint-prompt").isVisible();
  expect(aWon).not.toBe(bWon);

  const winner = aWon ? pageA : pageB;
  const loser  = aWon ? pageB : pageA;

  // The loser's attempt never lands — server-rejected if it reached the
  // network, locally no-opped if its target segment unmounted first (it
  // was empty and went non-interactive the instant the winner's reply
  // arrived). Either way: no card, no hand change, no misplacement.
  await expect(loser.locator(".hand-rail .hand-card")).toHaveCount(6);
  await expect(winner.locator(".hand-rail .hand-card")).toHaveCount(5);
});
