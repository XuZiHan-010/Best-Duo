import { test, expect } from "./fixtures.js";
import { joinAndReady, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("selected level number matches the in-game topbar", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await joinAndReady(pageA, "Alice");
  await joinAndReady(pageB, "Bob");
  await pageA.getByRole("button", { name: "开始游戏" }).click();
  await expect(pageA.locator(".level-select")).toBeVisible();

  await pageA.locator(".level-select__card").first().click();

  await expect(pageA.locator(".topbar__level")).toHaveText("第 1 关");
  await expect(pageB.locator(".topbar__level")).toHaveText("第 1 关");
});
