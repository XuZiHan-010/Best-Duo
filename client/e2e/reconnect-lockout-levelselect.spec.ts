import { test, expect } from "@playwright/test";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// §2.2: reconnecting must disable every action that emits to the server,
// not just in the lobby — this covers LevelSelect's host-only level cards.
test("reconnecting host can't select a level in LevelSelect", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await expect(pageA.locator(".level-select")).toBeVisible();

  await contextA.setOffline(true);
  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位…");
  await expect(pageA.locator(".level-select__card").first()).toBeDisabled();

  // Leave the room fully reconnected (matching reconnect.spec.ts) — closing
  // a still-disconnected context here would leave a server-side seat-hold
  // timeout pending, which can fire mid-way through the next test and steal
  // its room.host (the timeout closure holds a stale Seat object from
  // *this* room generation; room:reset rebuilds `room.seats` from scratch
  // but never cancels timers tied to the old seat objects).
  await contextA.setOffline(false);
  await expect(pageA.locator(".topbar__conn")).toHaveCount(0);
});
