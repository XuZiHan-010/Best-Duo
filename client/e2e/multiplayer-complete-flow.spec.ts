import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import {
  joinAndReady,
  placeAllHumanCardsAndReachReveal,
  resetRoom,
  setupHumanPlayersInPlacing,
} from "./helpers.js";

test.beforeEach(resetRoom);

async function placeHumanCardDuringAgentGame(
  page: Page,
  expectedHandCount: number,
  segment: number,
) {
  const handCards = page.locator(".hand-rail .hand-card");
  const expectedAfterPlacement = expectedHandCount - 1;

  // During the opening race an Agent can win after the human selected a card
  // but before the segment click. The resulting room state clears the local
  // selection and makes the overlay non-interactive. Retry the whole selection
  // only while the hand count proves that the human action was not applied.
  await expect(async () => {
    const currentHandCount = await handCards.count();
    if (currentHandCount === expectedAfterPlacement) return;
    expect(currentHandCount).toBe(expectedHandCount);

    await expect(handCards.first()).toBeEnabled({ timeout: 1_000 });
    await handCards.first().click({ timeout: 1_000 });
    await page
      .locator(`[data-segment="${segment}"].clock-segment-overlay--interactive`)
      .click({ timeout: 1_000 });
  }).toPass({ timeout: 15_000, intervals: [100, 250, 500] });

  await page.getByRole("button", { name: "不翻开" }).click();
  await expect(handCards).toHaveCount(expectedAfterPlacement);
}

for (const nicks of [
  ["Alice", "Bob", "Carol"],
  ["Alice", "Bob", "Carol", "Dave"],
]) {
  test(`${nicks.length} human players complete a game from lobby through result`, async ({ browser }) => {
    const { pages } = await setupHumanPlayersInPlacing(browser, nicks);
    const expectedHandSize = 12 / nicks.length;

    for (const page of pages) {
      await expect(page.locator(".hand-rail .hand-card")).toHaveCount(expectedHandSize);
    }

    await placeAllHumanCardsAndReachReveal(pages);
    await expect(pages[0].locator(".placed-card")).toHaveCount(12);

    await pages[0].getByRole("button", { name: "继续 →" }).click();
    for (const page of pages) {
      await expect(page.locator(".result")).toBeVisible();
    }
  });
}

for (const agentCount of [1, 3]) {
  test(`one human and ${agentCount} scripted agent(s) complete a game`, async ({ browser }, testInfo) => {
    testInfo.setTimeout(45_000);
    const context = await browser.newContext();
    const page = await context.newPage();
    await joinAndReady(page, "Alice");

    for (let index = 0; index < agentCount; index += 1) {
      await page.getByRole("button", { name: "添加 AI" }).first().click();
      await expect(page.locator(".player-seat--agent")).toHaveCount(index + 1);
    }

    await page.getByRole("button", { name: "开始游戏" }).click();
    await page.locator(".level-select__card").first().click();
    await page.getByRole("button", { name: "已了解，开始讨论 →" }).click();
    await page.getByRole("button", { name: "▶ 提前开始出牌" }).click();
    await expect(page.locator(".placing")).toBeVisible();

    const playerCount = agentCount + 1;
    const humanHandSize = 12 / playerCount;
    await expect(page.locator(".hand-rail .hand-card")).toHaveCount(humanHandSize);

    for (let index = 0; index < humanHandSize; index += 1) {
      // 初始 race 可能由 Agent 获胜，且下一位 Agent 可以在客户端观察到
      // 中间牌数前继续落子；用本玩家手牌与可交互覆盖层同步整个操作。
      await placeHumanCardDuringAgentGame(
        page,
        humanHandSize - index,
        index % 6,
      );
    }

    await expect(page.locator(".reveal")).toBeVisible();
    await expect(page.locator(".placed-card")).toHaveCount(12);
    await page.getByRole("button", { name: "继续 →" }).click();
    await expect(page.locator(".result")).toBeVisible();
  });
}

test("two humans and one scripted agent complete a game", async ({ browser }) => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [pageA, pageB] = await Promise.all(contexts.map((context) => context.newPage()));
  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await pageA.getByRole("button", { name: "添加 AI" }).first().click();
  await expect(pageA.locator(".player-seat--agent")).toHaveCount(1);

  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await pageA.locator(".level-select__card").first().click();
  for (const page of [pageA, pageB]) {
    await page.getByRole("button", { name: "已了解，开始讨论 →" }).click();
  }
  await pageA.getByRole("button", { name: "▶ 提前开始出牌" }).click();
  await expect(pageA.locator(".hand-rail .hand-card")).toHaveCount(4);
  await expect(pageB.locator(".hand-rail .hand-card")).toHaveCount(4);

  for (let round = 0; round < 4; round += 1) {
    for (const page of [pageA, pageB]) {
      await placeHumanCardDuringAgentGame(page, 4 - round, round % 6);
    }
  }

  await expect(pageA.locator(".reveal")).toBeVisible();
  await expect(pageB.locator(".reveal")).toBeVisible();
  await expect(pageA.locator(".placed-card")).toHaveCount(12);
  await pageA.getByRole("button", { name: "继续 →" }).click();
  await expect(pageA.locator(".result")).toBeVisible();
  await expect(pageB.locator(".result")).toBeVisible();
});

test("four-human placing UI remains reachable on a mobile viewport", async ({ browser }) => {
  test.setTimeout(45_000);
  const { pages } = await setupHumanPlayersInPlacing(browser, ["Alice", "Bob", "Carol", "Dave"]);
  const hostPage = pages[0];
  await hostPage.setViewportSize({ width: 390, height: 844 });

  await expect(hostPage.locator(".hand-rail .hand-card")).toHaveCount(3);
  await expect(hostPage.locator(".placing__teammate-list .placing__player")).toHaveCount(3);
  expect(
    await hostPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);

  await hostPage.locator(".hand-rail .hand-card").first().click();
  await hostPage.locator('[data-segment="0"]').click();
  await expect(hostPage.locator('[data-segment="0"] .placed-card')).toHaveCount(1);
});
