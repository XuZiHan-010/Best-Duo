import { test, expect } from "./fixtures.js";
import { placeFirstHandCard, resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

test("teammate sees hint-decision state after a card is placed", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  await placeFirstHandCard(pageA, 0);

  await expect(pageB.locator('[data-segment="0"] .placed-card')).toHaveCount(1);
  await expect(pageB.getByText("等待 Alice 决定是否使用提示标记")).toBeVisible();
  await expect(pageB.getByText("决定提示标记中...")).toBeVisible();
  await expect(pageB.getByText("出牌中...")).toHaveCount(0);
});

test("reconnected player actively syncs to the latest pending hint state", async ({ browser }) => {
  const { contextB, pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  await contextB.setOffline(true);
  await expect(pageB.locator(".topbar__conn")).toHaveCount(1);

  await placeFirstHandCard(pageA, 0);

  await contextB.setOffline(false);
  await expect(pageB.locator(".topbar__conn")).toHaveCount(0);
  await expect(pageB.locator('[data-segment="0"] .placed-card')).toHaveCount(1);
  await expect(pageB.getByText("等待 Alice 决定是否使用提示标记")).toBeVisible();
});
