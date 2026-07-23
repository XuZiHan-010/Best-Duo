import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

test("结束游戏保留玩家座位并让所有人回到准备界面", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser, {
    viewport: { width: 390, height: 844 }
  });

  await pageB.getByRole("button", { name: "结束游戏" }).click();
  await expect(pageB.getByText("结束本局并返回准备房间？")).toBeVisible();
  const hasHorizontalOverflow = await pageB.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
  await pageB.getByRole("button", { name: "确认", exact: true }).click();

  await expect(pageA.locator(".lobby")).toBeVisible();
  await expect(pageB.locator(".lobby")).toBeVisible();
  await expect(pageA.locator(".player-seat--me")).toContainText("Alice");
  await expect(pageB.locator(".player-seat--me")).toContainText("Bob");
  await expect(pageA.getByRole("button", { name: "准备", exact: true })).toBeVisible();
  await expect(pageB.getByRole("button", { name: "准备", exact: true })).toBeVisible();
  await expect(pageA.locator(".auth")).toHaveCount(0);
  await expect(pageB.locator(".auth")).toHaveCount(0);

  // 新一轮仍可正常准备，证明座位会话没有被结束游戏撤销。
  await pageA.getByRole("button", { name: "准备", exact: true }).click();
  await expect(pageA.locator(".player-seat--me.player-seat--ready")).toBeVisible();
  await expect(pageB.locator(".player-seat--ready", { hasText: "Alice" })).toBeVisible();
});
