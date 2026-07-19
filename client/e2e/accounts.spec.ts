import { test, expect } from "./fixtures.js";
import { E2E_ACCOUNT_PASSWORD, join, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("注册后退出，再用同昵称同密码登录可重新进入大厅", async ({ browser }) => {
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

test("错误的个人密码停留在登录页并显示中文错误，原座位不受影响", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "AccBob");
  await expect(pageA.locator(".player-seat--me")).toBeVisible();

  await join(pageB, "AccBob", "wrong-pass");
  await expect(pageB.locator("#login-error")).toContainText("密码不正确");
  await expect(pageB.locator(".login")).toBeVisible();

  await expect(pageA.locator(".player-seat--me")).toBeVisible();
  await contextA.close();
  await contextB.close();
});

test("正确的账号密码可从新浏览器接管在线座位", async ({ browser }) => {
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

test("换新昵称登录视为新玩家，两个座位并存", async ({ browser }) => {
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
