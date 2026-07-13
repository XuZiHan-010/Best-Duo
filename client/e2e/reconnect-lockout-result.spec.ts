import { test, expect } from "./fixtures.js";
import { placeAllCardsAndReachResult, resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

// §2.2: reconnecting must disable Result's host-only actions (retry / next /
// back to level select) — these discard the current board state.
test("reconnecting host can't act on Result", async ({ browser }) => {
  // Placing all 12 cards is 36 sequential UI actions across two pages —
  // comfortably slower than the suite's other specs, so the default 30s
  // budget is too tight under load.
  test.setTimeout(60_000);
  const { contextA, pageA, pageB } = await setupTwoPlayersInPlacing(browser);
  await placeAllCardsAndReachResult(pageA, pageB);

  await contextA.setOffline(true);
  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位…");
  await expect(pageA.getByRole("button", { name: "返回选关" })).toBeDisabled();

  // Leave the room fully reconnected (matching reconnect.spec.ts) — closing
  // a still-disconnected context here would leave a server-side seat-hold
  // timeout pending, which can fire mid-way through the next test and steal
  // its room.host (the timeout closure holds a stale Seat object from
  // *this* room generation; room:reset rebuilds `room.seats` from scratch
  // but never cancels timers tied to the old seat objects).
  await contextA.setOffline(false);
  await expect(pageA.locator(".topbar__conn")).toHaveCount(0);
});
