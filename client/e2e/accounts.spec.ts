import { test, expect } from "./fixtures.js";
import { E2E_ACCOUNT_PASSWORD, join, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("生产入口按 URL 提供邮箱登录和显式注册，不再显示昵称隐式注册", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "欢迎回来" })).toBeVisible();
  await expect(page.getByLabel("邮箱")).toBeVisible();
  await expect(page.getByLabel("游戏昵称")).toHaveCount(0);
  await expect(page.getByText("首次输入即注册")).toHaveCount(0);

  await page.getByRole("link", { name: "注册", exact: true }).click();
  await expect(page).toHaveURL(/\/account\/register$/);
  await expect(page.getByRole("heading", { name: "创建玩家账号" })).toBeVisible();
  await expect(page.getByLabel("确认密码")).toBeVisible();
  await expect(page.getByLabel("游戏昵称")).toBeVisible();
});

test("注册表单在较矮桌面视口中可滚动到最后一项和提交按钮", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto("/account/register");

  const scrollOwner = page.locator(".room-view__main");
  await expect.poll(() => scrollOwner.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);

  await page.getByLabel("游戏昵称").scrollIntoViewIfNeeded();
  await page.getByLabel("游戏昵称").fill("ShortViewport");
  await page.getByLabel("房间密码").fill("1234");
  await page.getByRole("button", { name: "创建账号并进入大厅" }).scrollIntoViewIfNeeded();
  await expect(page.getByRole("button", { name: "创建账号并进入大厅" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("邮箱注册后退出，再用同一邮箱和密码登录可重新进入大厅", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  await join(pageA, "AccAlice");
  await expect(pageA.locator(".player-seat--me")).toBeVisible();
  await contextA.close();

  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  await join(pageB, "AccAlice");
  await expect(pageB.locator(".player-seat--me")).toBeVisible();
  await expect(pageB.locator(".player-seat", { hasText: "AccAlice" })).toHaveCount(1);
  await contextB.close();
});

test("邮箱正确但个人密码错误时停留在登录页，原座位不受影响", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "AccBob");
  await expect(pageA.locator(".player-seat--me")).toBeVisible();

  await join(pageB, "AccBob", "wrong-pass");
  await expect(pageB.locator("#auth-error")).toContainText("邮箱或密码不正确");
  await expect(pageB.locator(".auth")).toBeVisible();

  await expect(pageA.locator(".player-seat--me")).toBeVisible();
  await contextA.close();
  await contextB.close();
});

test("正确的邮箱账号密码可从新浏览器接管在线座位", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "AccCarl");
  await expect(pageA.locator(".player-seat--me")).toBeVisible();

  await join(pageB, "AccCarl", E2E_ACCOUNT_PASSWORD);
  await expect(pageB.locator(".player-seat--me")).toBeVisible();
  await expect(pageB.locator(".player-seat", { hasText: "AccCarl" })).toHaveCount(1);

  // 旧浏览器被服务端强制断开（"io server disconnect" 不会自动重连），
  // 停留在恢复横幅——与 ADR-0005 会话接管后旧端的既有表现一致
  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位", { timeout: 10_000 });
  await contextA.close();
  await contextB.close();
});

test("不同邮箱可注册为两个独立玩家并同时入座", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "AccDana");
  await expect(pageA.locator(".player-seat--me")).toBeVisible();

  await join(pageB, "AccErin");
  await expect(pageB.locator(".player-seat--me")).toBeVisible();
  await expect(pageB.locator(".player-seat", { hasText: "AccDana" })).toHaveCount(1);
  await expect(pageB.locator(".player-seat", { hasText: "AccErin" })).toHaveCount(1);
  await contextA.close();
  await contextB.close();
});
