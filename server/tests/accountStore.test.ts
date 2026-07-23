import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAccountStore,
  defaultAvatarForPlayer,
  normalizeEmail,
  normalizeNickname
} from "../src/auth/accountStore.js";

const EMAIL_KEY = Buffer.alloc(32, 7).toString("base64");
const tmpDirs: string[] = [];
const makeDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-accounts-v2-"));
  tmpDirs.push(dir);
  return dir;
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const register = (store: ReturnType<typeof createAccountStore>, overrides: Record<string, string> = {}) =>
  store.register({
    email: overrides.email ?? "Penguin@Example.COM",
    password: overrides.password ?? "password-1",
    nickname: overrides.nickname ?? "企鹅",
    avatar: null
  });

describe("accountStore schema v2", () => {
  it("规范化邮箱、加密落盘并用邮箱登录", async () => {
    const dir = makeDir();
    const store = createAccountStore(dir, EMAIL_KEY);
    const created = await register(store);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(created.account.email).toBe("Penguin@example.com");
    expect(created.account.avatar).toBe(defaultAvatarForPlayer(created.account.playerId));
    const raw = fs.readFileSync(path.join(dir, "accounts.json"), "utf8");
    expect(raw).toContain('"schemaVersion": 2');
    expect(raw).not.toContain("Penguin@example.com");
    expect(raw).not.toContain("password-1");

    const reloaded = createAccountStore(dir, EMAIL_KEY);
    const login = await reloaded.authenticate({ email: "Penguin@EXAMPLE.COM", password: "password-1" });
    expect(login.ok).toBe(true);
    if (login.ok) expect(login.account.playerId).toBe(created.account.playerId);
  });

  it("邮箱和 NFKC/大小写规范化昵称均账号级唯一", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    expect((await register(store, { nickname: "Ａlice" })).ok).toBe(true);
    expect(
      await register(store, { email: "Penguin@example.COM", nickname: "另一个", password: "password-2" })
    ).toEqual({ ok: false, reason: "email_taken" });
    expect(
      await register(store, { email: "other@example.com", nickname: "alice", password: "password-2" })
    ).toEqual({ ok: false, reason: "nickname_unavailable" });

    expect(normalizeEmail(" A@Example.COM ")).toBe("A@example.com");
    expect(normalizeNickname(" Ａlice ")).toBe("alice");
  });

  it("登录对不存在、错误密码和停用账号统一返回 invalid_credentials", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    const created = await register(store);
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(await store.authenticate({ email: "missing@example.com", password: "password-1" })).toEqual({
      ok: false,
      reason: "invalid_credentials"
    });
    expect(await store.authenticate({ email: created.account.email, password: "password-x" })).toEqual({
      ok: false,
      reason: "invalid_credentials"
    });
    await store.setStatus(created.account.playerId, "disabled");
    expect(await store.authenticate({ email: created.account.email, password: "password-1" })).toEqual({
      ok: false,
      reason: "invalid_credentials"
    });
  });

  it("更新公开资料会持久化昵称与头像，恢复默认时保持会话版本", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    const created = await register(store);
    if (!created.ok) throw new Error("registration failed");
    const customAvatar = "data:image/png;base64,AA==";
    const changed = await store.updateProfile(created.account.playerId, {
      nickname: "新昵称",
      avatar: customAvatar
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.account.playerId).toBe(created.account.playerId);
    expect(changed.account.email).toBe(created.account.email);
    expect(changed.account.avatar).toBe(customAvatar);
    expect(changed.account.credentialVersion).toBe(created.account.credentialVersion);
    expect(changed.account.nicknameChangedAt).not.toBeNull();

    const restored = await store.updateProfile(created.account.playerId, {
      nickname: "新昵称",
      avatar: null
    });
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.account.avatar).toBe(defaultAvatarForPlayer(created.account.playerId));
    expect(restored.account.nicknameChangedAt).toBe(changed.account.nicknameChangedAt);
    expect(restored.account.credentialVersion).toBe(created.account.credentialVersion);
  });

  it("改密和换邮验证当前密码、递增 credentialVersion，并让旧凭证失效", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    const created = await register(store);
    if (!created.ok) throw new Error("registration failed");

    expect(await store.changePassword(created.account.playerId, "wrong-password", "password-2")).toEqual({
      ok: false,
      reason: "invalid_credentials"
    });
    const passwordChanged = await store.changePassword(created.account.playerId, "password-1", "password-2");
    expect(passwordChanged.ok).toBe(true);
    if (!passwordChanged.ok) return;
    expect(passwordChanged.account.credentialVersion).toBe(2);
    expect((await store.authenticate({ email: created.account.email, password: "password-1" })).ok).toBe(false);

    const emailChanged = await store.changeEmail(
      created.account.playerId,
      "password-2",
      "new-address@EXAMPLE.com"
    );
    expect(emailChanged.ok).toBe(true);
    if (!emailChanged.ok) return;
    expect(emailChanged.account.email).toBe("new-address@example.com");
    expect(emailChanged.account.credentialVersion).toBe(3);
    expect((await store.authenticate({ email: created.account.email, password: "password-2" })).ok).toBe(false);
    expect((await store.authenticate({ email: emailChanged.account.email, password: "password-2" })).ok).toBe(true);
  });

  it("停用保留邮箱和昵称，软删除释放二者且重注册获得新 playerId", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    const created = await register(store);
    if (!created.ok) throw new Error("registration failed");

    const disabled = await store.setStatus(created.account.playerId, "disabled");
    expect(disabled.ok && disabled.account.credentialVersion).toBe(2);
    expect(await register(store)).toEqual({ ok: false, reason: "email_taken" });
    expect(
      await register(store, { email: "other@example.com", nickname: "企鹅", password: "password-2" })
    ).toEqual({ ok: false, reason: "nickname_unavailable" });

    expect(await store.softDelete(created.account.playerId)).toEqual({ ok: true });
    const replacement = await register(store);
    expect(replacement.ok).toBe(true);
    if (replacement.ok) expect(replacement.account.playerId).not.toBe(created.account.playerId);
  });

  it("管理员列表只给脱敏邮箱，删除墓碑不保留敏感字段", async () => {
    const dir = makeDir();
    const store = createAccountStore(dir, EMAIL_KEY);
    const created = await register(store);
    if (!created.ok) throw new Error("registration failed");
    const active = store.listAccounts()[0];
    expect(active.maskedEmail).toBe("P***@example.com");
    expect(JSON.stringify(active)).not.toContain("Penguin@example.com");

    await store.softDelete(created.account.playerId);
    const parsed = JSON.parse(fs.readFileSync(path.join(dir, "accounts.json"), "utf8")) as {
      accounts: Array<Record<string, unknown>>;
    };
    const tombstone = parsed.accounts.find((account) => account.playerId === created.account.playerId)!;
    expect(tombstone).toMatchObject({
      status: "deleted",
      nickname: null,
      emailLookupHash: null,
      emailCiphertext: null,
      passwordSalt: null,
      passwordHash: null,
      kdf: null
    });
    const backup = fs.readFileSync(path.join(dir, "accounts.json.bak"), "utf8");
    expect(backup).not.toContain("emailCiphertext\": \"");
    expect(backup).not.toContain("passwordHash\": \"");
  });

  it("软删除刷新备份失败时不提交主文件，磁盘与内存保持旧状态", async () => {
    const dir = makeDir();
    const store = createAccountStore(dir, EMAIL_KEY);
    const created = await register(store);
    if (!created.ok) throw new Error("registration failed");
    const filePath = path.join(dir, "accounts.json");
    const before = fs.readFileSync(filePath, "utf8");
    const renameSync = fs.renameSync.bind(fs);

    vi.spyOn(fs, "renameSync").mockImplementation((oldPath, newPath) => {
      if (String(newPath).endsWith("accounts.json.bak")) throw new Error("backup unavailable");
      return renameSync(oldPath, newPath);
    });

    expect(await store.softDelete(created.account.playerId)).toEqual({
      ok: false,
      reason: "store_unavailable"
    });
    expect(fs.readFileSync(filePath, "utf8")).toBe(before);
    expect(store.getByPlayerId(created.account.playerId)?.status).toBe("active");
    expect(store.isAvailable()).toBe(false);
  });

  it("审计 JSONL 不可写时返回失败，并把完整非敏感记录写入结构化日志", async () => {
    const dir = makeDir();
    const store = createAccountStore(dir, EMAIL_KEY);
    fs.mkdirSync(path.join(dir, "account-admin-audit.jsonl"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const entry = {
      auditId: "audit-1",
      operator: "admin",
      targetPlayerId: "player-1",
      action: "forceLogout" as const,
      at: 123,
      reason: "安全检查",
      result: "success" as const
    };

    expect(store.appendAdminAudit(entry)).toBe(false);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"targetPlayerId":"player-1"'));
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('"result":"success"'));
  });

  it("损坏文件、旧 schema、缺少或错误密钥时均 fail-closed 且不覆盖", async () => {
    for (const body of ["{broken", '{"schemaVersion":1,"accounts":[]}']) {
      const dir = makeDir();
      const filePath = path.join(dir, "accounts.json");
      fs.writeFileSync(filePath, body, "utf8");
      const store = createAccountStore(dir, EMAIL_KEY);
      expect(store.isAvailable()).toBe(false);
      expect(await register(store)).toEqual({ ok: false, reason: "store_unavailable" });
      expect(fs.readFileSync(filePath, "utf8")).toBe(body);
    }

    const missingKey = createAccountStore(makeDir(), undefined);
    expect(missingKey.isAvailable()).toBe(false);
    expect(await register(missingKey)).toEqual({ ok: false, reason: "store_unavailable" });

    const dir = makeDir();
    expect((await register(createAccountStore(dir, EMAIL_KEY))).ok).toBe(true);
    const wrongKey = createAccountStore(dir, Buffer.alloc(32, 8).toString("base64"));
    expect(wrongKey.isAvailable()).toBe(false);
  });

  it("并发注册不会绕过邮箱唯一性", async () => {
    const store = createAccountStore(makeDir(), EMAIL_KEY);
    const results = await Promise.all([
      register(store, { email: "race@example.com", nickname: "甲", password: "password-1" }),
      register(store, { email: "race@example.com", nickname: "乙", password: "password-2" })
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, reason: "email_taken" }]);
  });
});
