import { test, expect } from "./fixtures.js";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// §2.2: reconnecting must disable Discussion's host-only "begin early" action.
test("reconnecting host can't begin placement early in Discussion", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await pageA.locator(".level-select__card").first().click();
  await pageA.getByRole("button", { name: "已了解，开始讨论 →" }).click();
  await pageB.getByRole("button", { name: "已了解，开始讨论 →" }).click();
  await expect(pageA.locator(".discussion")).toBeVisible();

  await contextA.setOffline(true);
  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位…");
  await expect(pageA.getByRole("button", { name: "▶ 提前开始出牌" })).toBeDisabled();

  // Leave the room fully reconnected (matching reconnect.spec.ts) — closing
  // a still-disconnected context here would leave a server-side seat-hold
  // timeout pending, which can fire mid-way through the next test and steal
  // its room.host (the timeout closure holds a stale Seat object from
  // *this* room generation; room:reset rebuilds `room.seats` from scratch
  // but never cancels timers tied to the old seat objects).
  await contextA.setOffline(false);
  await expect(pageA.locator(".topbar__conn")).toHaveCount(0);
});
