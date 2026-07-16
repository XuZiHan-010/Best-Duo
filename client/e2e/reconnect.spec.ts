import { test, expect } from "./fixtures.js";
import { join, ready, resetRoom } from "./helpers.js";

test.beforeEach(resetRoom);

test("dropping a connection shows the recovering state, then rebuilds room:state on reconnect", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "Alice");
  await ready(pageA);
  await join(pageB, "Bob");

  await contextA.setOffline(true);

  await expect(pageA.locator(".topbar__conn")).toContainText("正在恢复座位…");
  await expect(pageA.locator(".lobby__waiting")).toContainText("正在恢复连接");

  await contextA.setOffline(false);

  await expect(pageA.locator(".topbar__conn")).toHaveCount(0);
  await expect(pageA.locator(".topbar__seat-dot--host.topbar__seat-dot--me")).toHaveCount(1);

  // The stale pre-disconnect roomState alone would already show the host
  // badge — that's not proof the reconnected socket is actually re-attached
  // to seat A server-side. Toggle ready again: PlayerReady requires a live
  // seatId on the socket, so this only succeeds on a real re-attachment.
  await pageA.getByRole("button", { name: "已准备", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "准备", exact: true })).toBeVisible();
  await expect(pageA.locator(".toast--error")).toHaveCount(0);
  await expect(pageB.getByText("等待准备...")).toBeVisible();
});

test("a duplicate nickname from another browser is rejected and cannot steal the seat", async ({ browser }) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await join(pageA, "Alice");
  await ready(pageA);

  // 攻击路径：另一浏览器用相同昵称+正确房间密码加入
  await join(pageB, "Alice");

  // 攻击者停留在登录页并看到占用提示
  await expect(pageB.locator("#login-error")).toContainText("该昵称正在使用中");
  await expect(pageB.locator(".login")).toBeVisible();

  // 原玩家完全不受影响：座位仍在、可正常操作
  await expect(pageA.locator(".player-seat--me.player-seat--ready")).toBeVisible();
  await pageA.getByRole("button", { name: "已准备", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "准备", exact: true })).toBeVisible();
  await expect(pageA.locator(".toast--error")).toHaveCount(0);
});

test("a page refresh restores the seat via the stored player session", async ({ browser }) => {
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();

  await join(pageA, "Alice");
  await ready(pageA);

  await pageA.reload();

  // 不经登录页直接恢复座位（会话在 sessionStorage，握手 auth 自动重连）
  await expect(pageA.locator(".player-seat--me.player-seat--ready")).toBeVisible();
  await pageA.getByRole("button", { name: "已准备", exact: true }).click();
  await expect(pageA.getByRole("button", { name: "准备", exact: true })).toBeVisible();
});
