import { test, expect } from "@playwright/test";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

// §2.2: reconnecting must disable card placement — a queued emit landing
// after the seat re-attaches would place a stale, un-intended card.
test("reconnecting player can't place a card in Placing", async ({ browser }) => {
  const { contextA, pageA } = await setupTwoPlayersInPlacing(browser);

  await contextA.setOffline(true);
  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位…");
  await expect(pageA.locator(".hand-rail .hand-card").first()).toBeDisabled();

  // Leave the room fully reconnected (matching reconnect.spec.ts) — closing
  // a still-disconnected context here would leave a server-side seat-hold
  // timeout pending, which can fire mid-way through the next test and steal
  // its room.host (the timeout closure holds a stale Seat object from
  // *this* room generation; room:reset rebuilds `room.seats` from scratch
  // but never cancels timers tied to the old seat objects).
  await contextA.setOffline(false);
  await expect(pageA.locator(".topbar__conn")).toHaveCount(0);
});
