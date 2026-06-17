import { test, expect } from "@playwright/test";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

// frontend-code-review-2026-06-16.md P1#6: the chat input has a label and
// autocomplete but was missing `name` — required for complete form semantics.
test("chat input has a stable name attribute", async ({ browser }) => {
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

  await expect(pageA.locator("#chat-input")).toHaveAttribute("name", "chat-message");
});
