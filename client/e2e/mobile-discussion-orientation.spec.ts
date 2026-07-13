import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import {
  resetRoom,
  setupTwoPlayersInDiscussion,
  setupTwoPlayersInPlacing,
  placeAllCardsAndReachReveal,
  type TwoPlayerSetup,
} from "./helpers.js";

test.beforeEach(resetRoom);

// Close every context this test opened. Leaked pages stay connected across
// tests (the shared browser lives for the whole worker) and auto-rejoin after
// room:reset, stealing the Alice/Bob nicks from the next test.
const openContexts: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(openContexts.splice(0).map((c) => c.close().catch(() => {})));
});
function track(setup: TwoPlayerSetup): TwoPlayerSetup {
  openContexts.push(setup.contextA, setup.contextB);
  return setup;
}

const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

interface Box { x: number; y: number; width: number; height: number; }

function intersects(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

async function box(page: Page, selector: string): Promise<Box> {
  const b = await page.locator(selector).boundingBox();
  expect(b, `expected a bounding box for ${selector}`).not.toBeNull();
  return b!;
}

async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector(".room-view__main") as HTMLElement | null;
    if (!main) return 0;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// §9.2 — non-host portrait: clock → status → chat → conditions vertical order,
// status does not overlay the clock and does not grow to fill space.
test("discussion portrait: waiting status sits under the clock, does not overlay it", async ({ browser }) => {
  // pageB is the non-host, so it renders .discussion__status.
  const { pageB } = track(await setupTwoPlayersInDiscussion(browser, { viewport: PORTRAIT }));

  const status = pageB.locator(".discussion__status").first();
  await expect(status).toBeVisible();

  const clock = await box(pageB, ".discussion__clock-col .clock-board");
  const statusBox = await box(pageB, ".discussion__status");
  const chat = await box(pageB, ".discussion__chat-col");
  const conditions = await box(pageB, ".discussion__conditions");

  // Vertical stacking order.
  expect(clock.y).toBeLessThan(statusBox.y);
  expect(statusBox.y).toBeLessThan(chat.y);
  expect(chat.y).toBeLessThan(conditions.y);

  // Status must not overlay the clock (the old .view-stub flex:1 bug).
  expect(intersects(clock, statusBox)).toBe(false);

  // Status takes only its text height — no flex-grow.
  const flexGrow = await status.evaluate((el) => getComputedStyle(el).flexGrow);
  expect(flexGrow).toBe("0");

  // Conditions bar is reachable via the page-level scroll owner.
  await pageB.locator(".discussion__conditions").scrollIntoViewIfNeeded();
  await expect(pageB.locator(".discussion__conditions")).toBeVisible();

  await assertNoHorizontalScroll(pageB);
});

// §9.3 — same page, portrait → short-landscape → portrait.
test("discussion survives portrait → landscape → portrait rotation", async ({ browser }) => {
  const { pageB } = track(await setupTwoPlayersInDiscussion(browser, { viewport: PORTRAIT }));

  const mainDirection = () =>
    pageB.evaluate(
      () => getComputedStyle(document.querySelector(".discussion__main") as HTMLElement).flexDirection,
    );

  // Portrait: vertical stack.
  expect(await mainDirection()).toBe("column");
  await assertNoHorizontalScroll(pageB);

  // Short-landscape: back to clock | chat row, no clipping, page still usable.
  await pageB.setViewportSize(LANDSCAPE);
  await expect.poll(mainDirection).toBe("row");
  const clockLand = await box(pageB, ".discussion__clock-col .clock-board");
  expect(clockLand.y).toBeGreaterThanOrEqual(0);
  await assertNoHorizontalScroll(pageB);

  // Back to portrait: no leftover row layout / frozen sizes.
  await pageB.setViewportSize(PORTRAIT);
  await expect.poll(mainDirection).toBe("column");
  await assertNoHorizontalScroll(pageB);
});

// §9.5 — Reveal's internal scroll is handed back to .room-view__main (§4.1):
// no nested scroll container, no horizontal page scroll.
test("reveal portrait: no nested scroll container, conditions reachable", async ({ browser }) => {
  // Reaching reveal drives all 12 card placements (each a socket round-trip),
  // which can exceed the default 30s late in a loaded serial run.
  test.setTimeout(90_000);
  const { pageA, pageB } = track(await setupTwoPlayersInPlacing(browser, { viewport: PORTRAIT }));

  await placeAllCardsAndReachReveal(pageA, pageB);

  // .reveal__main must not own a scroll on mobile — the page-level owner does.
  const revealMainOverflowY = await pageA.evaluate(
    () => getComputedStyle(document.querySelector(".reveal__main") as HTMLElement).overflowY,
  );
  expect(["visible", "clip"]).toContain(revealMainOverflowY);

  await assertNoHorizontalScroll(pageA);

  await pageA.locator(".reveal__conditions-col").scrollIntoViewIfNeeded();
  await expect(pageA.locator(".reveal__conditions-col")).toBeVisible();
});
