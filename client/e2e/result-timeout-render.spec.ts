import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

// A turn timeout (or a player leaving) fails the round directly from the
// server without ever populating `revealResult` (see reveal.ts failByTimeout
// / failByPlayerLeft). Result.tsx must still render the failure screen for
// these paths instead of getting stuck on the "加载结算中…" loading stub.
test("Result renders the failure screen (not stuck loading) when a turn times out", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  // Neither player acts — let the turn timer (default thinkSeconds = 5s)
  // expire and fail the round via failByTimeout.
  await expect(pageA.locator(".result")).toBeVisible({ timeout: 10_000 });
  await expect(pageB.locator(".result")).toBeVisible({ timeout: 10_000 });

  await expect(pageA.locator(".view-stub")).toHaveCount(0);
  await expect(pageA.getByText("挑战失败")).toBeVisible();
  await expect(pageA.getByText("回合超时判负")).toBeVisible();
  await expect(pageA.getByRole("button", { name: "返回选关" })).toBeVisible();
});
