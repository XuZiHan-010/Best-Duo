import { test, expect } from "./fixtures.js";
import {
  joinAndReady,
  placeAllHumanCardsAndReachReveal,
  resetRoom,
  setupHumanPlayersInPlacing,
} from "./helpers.js";

test.beforeEach(resetRoom);

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
  test(`one human and ${agentCount} scripted agent(s) complete a game`, async ({ browser }) => {
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
      await expect(page.locator(".hand-rail .hand-card").first()).toBeEnabled();
      await page.locator(".hand-rail .hand-card").first().click();
      await page.locator(`[data-segment="${index % 6}"]`).click();
      await page.getByRole("button", { name: "不翻开" }).click();
      await expect(page.locator(".placed-card")).toHaveCount((index + 1) * playerCount);
    }

    await expect(page.locator(".reveal")).toBeVisible();
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
      await expect(page.locator(".hand-rail .hand-card").first()).toBeEnabled();
      await page.locator(".hand-rail .hand-card").first().click();
      await page.locator(`[data-segment="${round % 6}"]`).click();
      await page.getByRole("button", { name: "不翻开" }).click();
    }
    await expect(pageA.locator(".placed-card")).toHaveCount((round + 1) * 3);
  }

  await expect(pageA.locator(".reveal")).toBeVisible();
  await expect(pageB.locator(".reveal")).toBeVisible();
  await pageA.getByRole("button", { name: "继续 →" }).click();
  await expect(pageA.locator(".result")).toBeVisible();
  await expect(pageB.locator(".result")).toBeVisible();
});
