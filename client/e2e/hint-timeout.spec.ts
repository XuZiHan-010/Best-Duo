import { test, expect } from "./fixtures.js";
import { resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

test.beforeEach(resetRoom);

test("hint prompt ignores Esc and auto-resolves to 'no' on timeout, handing the turn off", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  await pageA.locator(".hand-rail .hand-card").first().click();
  await pageA.locator('[data-segment="0"]').click();

  const noButton = pageA.getByRole("button", { name: "不翻开" });
  await expect(noButton).toBeVisible();
  await expect(noButton).toBeFocused();

  // Esc is intentionally a no-op for this dialog (see HintPrompt.tsx).
  await pageA.keyboard.press("Escape");
  await expect(pageA.locator(".hint-prompt")).toBeVisible();

  // HINT_WINDOW_MS is shortened for the e2e server (see playwright.config.ts).
  await expect(pageA.locator(".hint-prompt")).toBeHidden({ timeout: 8000 });

  // Timing out defaults to "no" — the card stays masked on the board.
  await expect(pageA.locator('[data-segment="0"] .placed-card--blind')).toBeVisible();
  await expect(pageB.getByText("轮到你出牌")).toBeVisible();
});
