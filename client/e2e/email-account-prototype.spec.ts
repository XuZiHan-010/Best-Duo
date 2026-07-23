import { expect, test } from "@playwright/test";

test.describe("第一阶段邮箱账号管理原型", () => {
  test("登录首页只有登录和注册，并明确不支持找回", async ({ page }) => {
    await page.goto("/prototype/account/login");

    await expect(page.getByRole("heading", { name: "登录", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "注册", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "找回密码", exact: true })).toHaveCount(0);
    await expect(page.getByText("当前不验证邮箱，也不支持找回密码", { exact: false })).toBeVisible();

    await page.getByLabel("邮箱", { exact: true }).fill("player@example.com");
    await page.getByLabel("个人密码").fill("player-password");
    await page.getByLabel("房间密码").fill("room-secret");
    await page.getByRole("button", { name: "登录", exact: true }).click();

    await expect(page.getByRole("heading", { name: "登录成功" })).toBeVisible();
  });

  test("玩家注册不需要邮箱验证码", async ({ page }) => {
    await page.goto("/prototype/account/register");

    await expect(page.getByText("当前不验证邮箱且无法找回密码", { exact: false })).toBeVisible();
    await page.getByLabel("游戏昵称").fill("测试钟匠");
    await page.getByLabel("邮箱", { exact: true }).fill("player@example.com");
    await page.getByLabel("个人密码", { exact: true }).fill("new-password");
    await page.getByLabel("确认密码").fill("new-password");
    await page.getByLabel("房间密码").fill("room-secret");
    await page.getByRole("button", { name: /创建账号/ }).click();

    await expect(page.getByRole("heading", { name: "注册成功" })).toBeVisible();
    await expect(page.getByText("无需邮箱验证", { exact: false })).toBeVisible();
    await expect(page.getByLabel("6 位验证码")).toHaveCount(0);
  });

  test("管理员只有账号维护动作，没有验证、找回或代设密码", async ({ page }) => {
    await page.goto("/prototype/admin");

    await expect(page.getByRole("heading", { name: "注册账号" })).toBeVisible();
    await expect(page.getByText("邮件能力未启用", { exact: false })).toBeVisible();
    await expect(page.getByText("管理员不能代换邮箱或代设密码", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: /发送找回邮件|重发验证邮件|更换邮箱|重置密码/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /强制登出/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /停用账号/ })).toBeVisible();
  });

  test("管理员请出玩家只释放座位", async ({ page }) => {
    await page.goto("/prototype/admin/room");

    await expect(page.getByRole("heading", { name: "房间管理" })).toBeVisible();
    await page.getByRole("button", { name: /请出房间/ }).first().click();
    await expect(page.getByRole("heading", { name: "请出 A 座玩家？" })).toBeVisible();
    await page.getByRole("button", { name: "确认操作" }).click();

    await expect(page.getByText(/已被请出；注册账号保持正常/)).toBeVisible();
    await expect(page.getByText("等待玩家").first()).toBeVisible();
  });

  test("玩家可凭当前密码修改登录邮箱和密码", async ({ page }) => {
    await page.goto("/prototype/account/security");

    await expect(page.getByRole("heading", { name: "账号与游戏资料" })).toBeVisible();
    await expect(page.getByText("未验证", { exact: true })).toBeVisible();

    // 昵称账号级唯一（设计 §3.3）：撞名只提示“不可用”，不透露占用者是谁。
    await page.getByLabel("游戏昵称").fill("北纬三十度");
    await page.getByRole("button", { name: "保存昵称" }).click();
    await expect(page.getByText("该昵称不可用")).toBeVisible();

    await page.getByLabel("游戏昵称").fill("午夜钟匠");
    await page.getByRole("button", { name: "保存昵称" }).click();
    await expect(page.getByText("游戏昵称已更新为「午夜钟匠」")).toBeVisible();

    await page.getByRole("button", { name: "更换登录邮箱" }).click();
    const emailDialog = page.locator(".ep-dialog");
    await emailDialog.getByLabel("当前密码").fill("old-password");
    await emailDialog.getByLabel("新邮箱").fill("next@example.com");
    await emailDialog.getByRole("button", { name: "确认更换" }).click();
    await expect(page.getByText("登录邮箱已更新；请使用新邮箱登录")).toBeVisible();

    const securityGrid = page.locator(".ep-security-grid");
    await securityGrid.getByLabel("当前密码").fill("old-password");
    await securityGrid.getByLabel("新密码", { exact: true }).fill("next-password");
    await securityGrid.getByLabel("确认新密码").fill("next-password");
    await securityGrid.getByRole("button", { name: "保存新密码" }).click();
    await expect(page.getByText("密码已更新，旧会话已撤销")).toBeVisible();
  });
});
