import type { BrowserContext, Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing, type TwoPlayerSetup } from "./helpers.js";

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

const PORTRAIT = { width: 390, height: 844 }; // iPhone 13-ish
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

// The single page-level scroll owner (§4.1). No horizontal page scroll allowed.
async function assertNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => {
    const main = document.querySelector(".room-view__main") as HTMLElement | null;
    if (!main) return 0;
    return main.scrollWidth - main.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

// §9.1 — portrait placing is natural-flow, scrollable, no overlap.
test("placing portrait: badge above clock, hand reachable, no horizontal scroll", async ({ browser }) => {
  const { pageA } = track(await setupTwoPlayersInPlacing(browser, { viewport: PORTRAIT }));

  // TopBar trimmed (brand hidden) in the mobile shell.
  await expect(pageA.locator(".topbar__brand")).toBeHidden();

  // Turn badge sits in normal flow, fully above the clock box with a gap —
  // not overlapped by the clock (§11: ≥8px between the two boxes).
  const badge = await box(pageA, ".placing__turn-badge");
  const clock = await box(pageA, ".placing__center .clock-board");
  expect(intersects(badge, clock)).toBe(false);
  expect(clock.y - (badge.y + badge.height)).toBeGreaterThanOrEqual(8);

  // Hand rail is reachable by scrolling the page-level scroll owner.
  const handRail = pageA.locator(".hand-rail");
  await handRail.scrollIntoViewIfNeeded();
  await expect(handRail).toBeVisible();
  const hand = await handRail.boundingBox();
  expect(hand).not.toBeNull();
  expect(hand!.y).toBeGreaterThanOrEqual(0);
  expect(hand!.y + hand!.height).toBeLessThanOrEqual(PORTRAIT.height + 1);

  await assertNoHorizontalScroll(pageA);

  // Core placing interaction still works on mobile.
  await pageA.locator(".hand-rail .hand-card").first().click();
  await pageA.locator('[data-segment="0"]').click();
  await expect(pageA.locator('[data-segment="0"] .placed-card')).toHaveCount(1);
  await expect(pageA.locator(".toast--error")).toHaveCount(0);
});

// §9.4 — the hint decision dialog (fixed to the viewport) stays fully visible
// no matter where the page is scrolled.
test("placing portrait: hint prompt stays within the viewport when scrolled", async ({ browser }) => {
  const { pageA } = track(await setupTwoPlayersInPlacing(browser, { viewport: PORTRAIT }));

  // Scroll the page to the bottom first, then trigger the hint decision — an
  // absolutely-positioned overlay would land off-screen; the fixed one must not.
  await pageA.evaluate(() => {
    const main = document.querySelector(".room-view__main") as HTMLElement;
    main.scrollTop = main.scrollHeight;
  });

  await pageA.locator(".hand-rail .hand-card").first().click();
  await pageA.locator('[data-segment="0"]').click();

  const backdrop = pageA.locator(".hint-prompt-backdrop");
  await expect(backdrop).toBeVisible();
  const dialog = await box(pageA, ".hint-prompt");
  expect(dialog.x).toBeGreaterThanOrEqual(0);
  expect(dialog.y).toBeGreaterThanOrEqual(0);
  expect(dialog.x + dialog.width).toBeLessThanOrEqual(PORTRAIT.width + 1);
  expect(dialog.y + dialog.height).toBeLessThanOrEqual(PORTRAIT.height + 1);
});

// §9.3 — same page, portrait → short-landscape → portrait. No dead layout,
// clock never clipped above the fold, page keeps a usable scroll model.
test("placing survives portrait → landscape → portrait rotation", async ({ browser }) => {
  const { pageA } = track(await setupTwoPlayersInPlacing(browser, { viewport: PORTRAIT }));

  const placingDisplay = () =>
    pageA.evaluate(
      () => getComputedStyle(document.querySelector(".placing") as HTMLElement).display,
    );

  // Portrait: single-column flex.
  expect(await placingDisplay()).toBe("flex");
  await assertNoHorizontalScroll(pageA);

  // Rotate to short-landscape: the grid layout takes over.
  await pageA.setViewportSize(LANDSCAPE);
  await expect.poll(placingDisplay).toBe("grid");
  const clockLand = await box(pageA, ".placing__center .clock-board");
  expect(clockLand.y).toBeGreaterThanOrEqual(0); // not clipped above the fold
  await assertNoHorizontalScroll(pageA);

  // Rotate back: no leftover grid / frozen sizes.
  await pageA.setViewportSize(PORTRAIT);
  await expect.poll(placingDisplay).toBe("flex");
  await assertNoHorizontalScroll(pageA);
  await expect(pageA.locator(".placing__turn-badge")).toBeVisible();
});
