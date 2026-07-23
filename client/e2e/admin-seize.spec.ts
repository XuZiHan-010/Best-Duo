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
  await page.getByLabel("进入房间时的昵称").fill(nick);
  await page.getByRole("button", { name: "进入管理台" }).click();
  await expect(page.getByRole("heading", { name: "玩家账号维护" })).toBeVisible();
}

test("admin seize: decline is side-effect free, confirm kicks everyone and seats the admin as host", async ({ browser }) => {
  const { pageA, pageB } = await setupTwoPlayersInPlacing(browser);

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  // 后台登录本身不占座、不清场；进入房间才要求确认。
  await adminLogin(adminPage);
  await adminPage.getByRole("button", { name: "房间管理" }).click();
  await expect(adminPage.getByText("唯一房间管理")).toBeVisible();
  await adminPage.getByRole("button", { name: "以管理员身份进入房间" }).click();
  await expect(adminPage.getByRole("heading", { name: "确认接管房间" })).toBeVisible();

  // 选"否"：弹窗关闭，对局完全不受影响
  await adminPage.getByRole("button", { name: "取消", exact: true }).click();
  await expect(adminPage.getByRole("heading", { name: "确认接管房间" })).toHaveCount(0);
  await expect(pageA.locator(".placing")).toBeVisible();
  await expect(pageB.locator(".placing")).toBeVisible();

  // 再次发起并确认：强制接管
  await adminPage.getByRole("button", { name: "以管理员身份进入房间" }).click();
  await adminPage.getByRole("button", { name: "确认接管", exact: true }).click();

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
  await expect(pageA.locator(".auth")).toBeVisible();
});

test("admin enters an empty room directly and can kick a later joiner, who may rejoin as a new player", async ({ browser }) => {
  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();

  // 空房间：后台登录仍不入座；显式进入后直接成为房主。
  await adminLogin(adminPage);
  await adminPage.getByRole("button", { name: "房间管理" }).click();
  await adminPage.getByRole("button", { name: "以管理员身份进入房间" }).click();
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

  // 请出只释放座位，不等于退出账号：未入座仍可进入账户安全页。
  await playerPage.getByRole("button", { name: "返回登录" }).click();
  await playerPage.goto(SERVER_URL + "/account/security");
  await expect(playerPage.getByRole("heading", { name: "公开资料" })).toBeVisible();
  await expect(playerPage.getByLabel("游戏昵称")).toHaveValue("Newbie");

  // 返回大厅后仍可用另一账号加入。
  await join(playerPage, "Fresh");
  await expect(playerPage.locator(".player-seat--me")).toContainText("Fresh");
});

test("admin account console lists masked accounts and force-logs out with an audited reason", async ({ browser }) => {
  const playerContext = await browser.newContext();
  const playerPage = await playerContext.newPage();
  await join(playerPage, "AdminLedgerUser");

  const adminContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  await adminLogin(adminPage);

  const row = adminPage.locator("tr", { hasText: "AdminLedgerUser" });
  await expect(row).toBeVisible();
  await expect(row).toContainText("a***@e2e.example");
  await row.getByRole("button", { name: "强退" }).click();
  await adminPage.getByLabel("操作原因（将写入审计）").fill("E2E 安全检查");
  await adminPage.getByRole("button", { name: "确认强制退出" }).click();

  await expect(playerPage.locator(".kicked-notice")).toContainText("管理员已强制退出你的账号");
  await expect(adminPage.getByRole("status")).toContainText("强制登出");
  await playerContext.close();
  await adminContext.close();
});
