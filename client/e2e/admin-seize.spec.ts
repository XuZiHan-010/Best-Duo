import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures.js";
import { join, ready, resetRoom, setupTwoPlayersInPlacing } from "./helpers.js";

// Keep in sync with globalSetup.ts env.
const SERVER_URL = "http://127.0.0.1:3100";
const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "e2e-admin-secret";

test.beforeEach(resetRoom);

async function adminLogin(page: Page, nick = "管理员") {
  await page.goto(SERVER_URL + "/admin");
  await page.getByLabel("管理员账号").fill(ADMIN_USERNAME);
  await page.getByLabel("管理员密码").fill(ADMIN_PASSWORD);
  await page.getByLabel("入座昵称").fill(nick);
  await page.getByRole("button", { name: "登录" }).click();
}

test("admin seize: decline is side-effect free, confirm kicks everyone and seats the admin as host", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  // 登录后收到确认弹窗（对局中文案）
  await adminLogin(adminPage);
  await expect(adminPage.locator(".admin-confirm")).toBeVisible();
  await expect(adminPage.locator(".admin-confirm__title")).toContainText(
    "当前房间有玩家正在游戏，是否要强制进入房间并终止当前游戏？"
  );

  // 选"否"：弹窗关闭，对局完全不受影响
  await adminPage.getByRole("button", { name: "否", exact: true }).click();
  await expect(adminPage.locator(".admin-confirm")).toHaveCount(0);
  await expect(pageA.locator(".placing")).toBeVisible();
  await expect(pageB.locator(".placing")).toBeVisible();

  // 再次登录并选"是"：强制接管
  await adminPage.getByRole("button", { name: "登录" }).click();
  await expect(adminPage.locator(".admin-confirm")).toBeVisible();
  await adminPage.getByRole("button", { name: "是", exact: true }).click();

  // 两名玩家看到终态提示
  await expect(pageA.locator(".kicked-notice")).toContainText("管理员已强制结束当前游戏，您已被请出房间");
  await expect(pageB.locator(".kicked-notice")).toContainText("管理员已强制结束当前游戏，您已被请出房间");

  // 管理员跳回主页面，入座为房主
  await expect(adminPage.locator(".lobby")).toBeVisible();
  await expect(adminPage.locator(".player-seat--me .player-seat__host-badge")).toBeVisible();
  await expect(adminPage.locator(".player-seat--me")).toContainText("管理员");

  // 管理员刷新页面：会话恢复原座位，不触发第二次清场
  await adminPage.reload();
  await expect(adminPage.locator(".lobby")).toBeVisible();
  await expect(adminPage.locator(".player-seat--me .player-seat__host-badge")).toBeVisible();

  // 被踢玩家点"返回登录"后回登录页
  await pageA.getByRole("button", { name: "返回登录" }).click();
  await expect(pageA.locator(".login")).toBeVisible();
});

test("admin enters an empty room directly and can kick a later joiner, who may rejoin as a new player", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  // 空房间：登录后不弹确认，直接入座为房主
  await adminLogin(adminPage);
  await expect(adminPage.locator(".lobby")).toBeVisible();
  await expect(adminPage.locator(".player-seat--me .player-seat__host-badge")).toBeVisible();

  // 新玩家加入
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await join(playerPage, "Newbie");
  await ready(playerPage);
  await expect(adminPage.getByText("Newbie")).toBeVisible();

  // 管理员请出（内联二次确认）
  await adminPage.getByRole("button", { name: "请出", exact: true }).click();
  await adminPage.getByRole("button", { name: "确认请出", exact: true }).click();

  // 目标看到专属提示，房主不变
  await expect(playerPage.locator(".kicked-notice")).toContainText("你已被管理员请出房间");
  await expect(adminPage.getByText("Newbie")).toHaveCount(0);
  await expect(adminPage.locator(".player-seat--me .player-seat__host-badge")).toBeVisible();

  // 共享密码语义：被请出者可作为全新玩家再次加入
  await playerPage.getByRole("button", { name: "返回登录" }).click();
  await join(playerPage, "Fresh");
  await expect(playerPage.locator(".player-seat--me")).toContainText("Fresh");
});
