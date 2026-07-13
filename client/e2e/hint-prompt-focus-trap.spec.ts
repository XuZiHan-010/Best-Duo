import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

// frontend-code-review-2026-06-16.md P1#5: the background board must be
// `inert` while the hint dialog is open (not just pointer-events:none, which
// only blocks mouse/touch and leaves the board reachable to AT/keyboard),
// and Tab must cycle across whatever is actually focusable inside the
// dialog rather than a hand-rolled two-ref cycle.
test("hint prompt makes the background board inert and traps Tab generically", async ({ browser }) => {
  const { pageA } = await setupTwoPlayersInPlacing(browser);

  await pageA.locator(".hand-rail .hand-card").first().click();
  await pageA.locator('[data-segment="0"]').click();

  const noButton  = pageA.getByRole("button", { name: "不翻开" });
  const yesButton = pageA.getByRole("button", { name: "翻开牌" });
  await expect(noButton).toBeVisible();
  await expect(noButton).toBeFocused();

  const boardInert = await pageA.locator(".placing__center").evaluate(
    (el) => (el as HTMLElement).inert
  );
  expect(boardInert).toBe(true);

  // Forward: No -> Yes -> wraps back to No.
  await pageA.keyboard.press("Tab");
  await expect(yesButton).toBeFocused();
  await pageA.keyboard.press("Tab");
  await expect(noButton).toBeFocused();

  // Backward: Shift+Tab from No wraps to Yes.
  await pageA.keyboard.press("Shift+Tab");
  await expect(yesButton).toBeFocused();
});
