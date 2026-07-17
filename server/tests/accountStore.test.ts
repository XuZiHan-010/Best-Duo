import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAccountStore } from "../src/auth/accountStore.js";

const tmpDirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-accounts-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("accountStore", () => {
  it("首次昵称即注册并返回稳定 playerId", async () => {
    const store = createAccountStore(makeDir());
    const first = await store.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    expect(first.ok && first.created).toBe(true);
    const again = await store.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    expect(again.ok && !again.created).toBe(true);
    if (first.ok && again.ok) expect(again.account.playerId).toBe(first.account.playerId);
  });

  it("密码错误拒绝且不泄露摘要", async () => {
    const store = createAccountStore(makeDir());
    await store.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    const bad = await store.verifyOrRegister({ nick: "小明", accountPassword: "wxyz", avatar: null });
    expect(bad).toEqual({ ok: false, reason: "password_mismatch" });
  });

  it("注册后头像固定，后续提交的头像被忽略", async () => {
    const store = createAccountStore(makeDir());
    const dataUrl = "data:image/png;base64,aGk=";
    await store.verifyOrRegister({ nick: "小红", accountPassword: "abcd", avatar: dataUrl });
    const relogin = await store.verifyOrRegister({
      nick: "小红",
      accountPassword: "abcd",
      avatar: "data:image/png;base64,Ynll"
    });
    expect(relogin.ok).toBe(true);
    if (relogin.ok) expect(relogin.account.avatar).toBe(dataUrl);
  });

  it("跨实例持久化（模拟重启）", async () => {
    const dir = makeDir();
    const a = createAccountStore(dir);
    const created = await a.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    const b = createAccountStore(dir);
    const reloaded = await b.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    expect(created.ok && reloaded.ok).toBe(true);
    if (created.ok && reloaded.ok) {
      expect(reloaded.account.playerId).toBe(created.account.playerId);
      expect(reloaded.created).toBe(false);
    }
  });

  it("accounts.json 损坏时 fail-closed：拒绝注册与登录且不覆盖原文件", async () => {
    const dir = makeDir();
    const filePath = path.join(dir, "accounts.json");
    fs.writeFileSync(filePath, "{broken", "utf8");
    const store = createAccountStore(dir);
    const result = await store.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    expect(result).toEqual({ ok: false, reason: "store_unavailable" });
    expect(fs.readFileSync(filePath, "utf8")).toBe("{broken");
  });

  it("getByPlayerId 返回已注册账号", async () => {
    const store = createAccountStore(makeDir());
    const created = await store.verifyOrRegister({ nick: "小明", accountPassword: "abcd", avatar: null });
    expect(created.ok).toBe(true);
    if (created.ok) {
      expect(store.getByPlayerId(created.account.playerId)?.nick).toBe("小明");
    }
    expect(store.getByPlayerId("ghost")).toBeNull();
  });
});
