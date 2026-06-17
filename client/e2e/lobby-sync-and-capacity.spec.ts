import { test, expect } from "@playwright/test";
import { join, ready, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("seat/host state stays in sync across both browsers, and a third join is rejected", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "Alice");
  await join(pageB, "Bob");

  // First to ready becomes host — verify the badge lands on seat A for both ends.
  await ready(pageA);
  await expect(pageA.locator(".topbar__seat-dot--host")).toHaveCount(1);
  await expect(pageB.locator(".topbar__seat-dot--host")).toHaveCount(1);
  await expect(pageB.getByText("✓ 已准备")).toBeVisible();

  await ready(pageB);
  await expect(pageA.getByText("✓ 已准备")).toBeVisible();
  await expect(pageA.getByRole("button", { name: "开始游戏" })).toBeVisible();
  await expect(pageB.getByRole("button", { name: "开始游戏" })).toHaveCount(0);

  const contextC = await browser.newContext();
  const pageC = await contextC.newPage();
  await pageC.goto("/");
  await pageC.getByLabel("昵称").fill("Carol");
  await pageC.getByLabel("房间密码").fill("1234");
  await pageC.getByRole("button", { name: "进入房间" }).click();
  await expect(pageC.getByText("房间已满")).toBeVisible();
});
