import { test, expect } from "./fixtures.js";
import { join, resetRoom } from "./helpers.js";

const SERVER_URL = "http://127.0.0.1:3100";

test.beforeEach(resetRoom);

test("账户安全页通过真实 Socket 更新昵称与头像并同步房间座位", async ({ page }) => {
  await join(page, "SecurityUser");
  await page.getByRole("link", { name: "账户与安全设置" }).click();
  await expect(page).toHaveURL(/\/account\/security$/);
  await expect(page.getByRole("heading", { name: "公开资料" })).toBeVisible();

  await page.getByLabel("上传玩家头像").setInputFiles({
    name: "avatar.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64"
    )
  });
  await expect(page.locator(".account-avatar-preview .avatar__img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
  await page.getByLabel("游戏昵称").fill("SecurityRenamed");
  await page.getByRole("button", { name: "保存公开资料" }).click();
  await expect(page.getByRole("status")).toContainText("头像");

  await page.getByRole("button", { name: "登录设备" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销其他设备" }).click();
  await expect(page.getByRole("status")).toContainText("会话");

  await page.getByRole("link", { name: /返回游戏房间/ }).click();
  await expect(page.locator(".player-seat--me")).toContainText("SecurityRenamed");
  await expect(page.locator(".player-seat--me .avatar__img")).toHaveAttribute("src", /^data:image\/jpeg;base64,/);
});

test("账户安全页校验新密码确认，不向服务端发送不一致输入", async ({ page }) => {
  await join(page, "SecurityPassword");
  await page.getByRole("link", { name: "账户与安全设置" }).click();
  await page.getByRole("button", { name: "个人密码" }).click();
  await page.getByLabel("当前密码").fill("e2e-password");
  await page.getByLabel("新密码", { exact: true }).fill("new-password-1");
  await page.getByLabel("确认新密码").fill("new-password-2");
  await page.getByRole("button", { name: "更新密码" }).click();
  await expect(page.getByText("两次输入的新密码不一致")).toBeVisible();
});

test("账户安全页切换面板时清空所有密码输入", async ({ page }) => {
  await join(page, "SecuritySensitive");
  await page.getByRole("link", { name: "账户与安全设置" }).click();
  await page.getByRole("button", { name: "个人密码" }).click();
  await page.getByLabel("当前密码").fill("do-not-retain-this");
  await page.getByLabel("新密码", { exact: true }).fill("do-not-retain-new");

  await page.getByRole("button", { name: "登录邮箱" }).click();
  await expect(page.getByLabel("当前密码")).toHaveValue("");
  await page.getByLabel("当前密码").fill("email-panel-secret");

  await page.getByRole("button", { name: "个人密码" }).click();
  await expect(page.getByLabel("当前密码")).toHaveValue("");
  await expect(page.getByLabel("新密码", { exact: true })).toHaveValue("");
});

test("失效账号会话显示明确错误态而不是无限加载", async ({ page }) => {
  await page.goto(SERVER_URL + "/");
  await page.evaluate(() => {
    window.sessionStorage.setItem(
      "takeTime.accountSession",
      JSON.stringify({ playerId: "missing-player", accountToken: "invalid-token" })
    );
  });

  await page.goto(SERVER_URL + "/account/security");
  await expect(page.getByRole("heading", { name: "无法读取账户资料" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("账号会话已失效");
  await expect(page.getByText("正在读取账户资料")).toHaveCount(0);
});

test("已入座玩家访问管理台时不会自动恢复座位并跳回游戏", async ({ page }) => {
  await join(page, "AdminRoutePlayer");
  await page.goto(SERVER_URL + "/admin");

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "管理台登录" })).toBeVisible();
  await expect(page.locator(".lobby")).toHaveCount(0);
});
