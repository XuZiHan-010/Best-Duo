import { test, expect } from "./fixtures.js";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// frontend-code-review-2026-06-16.md P1#3: host cards are real <button>s;
// non-host cards must be plain, non-interactive elements (not disabled
// buttons) — a disabled <button> still announces "button" to AT users even
// though it can never be activated, which is misleading.
test("LevelSelect: host sees buttons, non-host sees non-interactive cards", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await expect(pageA.locator(".level-select")).toBeVisible();
  await expect(pageB.locator(".level-select")).toBeVisible();

  const hostCardTag = await pageA.locator(".level-select__card").first().evaluate((el) => el.tagName);
  expect(hostCardTag).toBe("BUTTON");

  const guestCardTag = await pageB.locator(".level-select__card").first().evaluate((el) => el.tagName);
  expect(guestCardTag).not.toBe("BUTTON");
});
