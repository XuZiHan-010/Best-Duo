import { describe, expect, it } from "vitest";
import {
  accountEmailChangeSchema,
  accountLoginSchema,
  accountPasswordChangeSchema,
  accountProfileUpdateSchema,
  accountRegisterSchema,
  adminAccountsSetStatusSchema,
  playerJoinSchema
} from "./schemas.js";

describe("playerJoinSchema 双分支", () => {
  const session = { playerId: "p1", reconnectToken: "t1" };

  it("会话分支：仅 nick + session 即合法，不要求密码", () => {
    expect(playerJoinSchema.safeParse({ nick: "小明", session }).success).toBe(true);
  });

  it("会话分支：兼容现网客户端附带的 password/accountPassword", () => {
    expect(
      playerJoinSchema.safeParse({ nick: "小明", password: "1234", accountPassword: "abcd", session }).success
    ).toBe(true);
  });

  it("账号分支：接受房间密码 + 个人密码", () => {
    expect(
      playerJoinSchema.safeParse({ nick: "小明", password: "1234", accountPassword: "abcd" }).success
    ).toBe(true);
  });

  it("账号分支：拒绝缺失或过短的 accountPassword", () => {
    expect(playerJoinSchema.safeParse({ nick: "小明", password: "1234" }).success).toBe(false);
    expect(
      playerJoinSchema.safeParse({ nick: "小明", password: "1234", accountPassword: "abc" }).success
    ).toBe(false);
  });

  it("账号分支：拒绝缺失房间密码", () => {
    expect(playerJoinSchema.safeParse({ nick: "小明", accountPassword: "abcd" }).success).toBe(false);
  });
});

describe("邮箱账号 schema", () => {
  it("注册要求合法邮箱、8–64 位密码、确认密码、昵称和房间密码", () => {
    const valid = {
      email: "user@example.com",
      password: "password-1",
      passwordConfirmation: "password-1",
      nickname: "玩家一",
      roomPassword: "1234"
    };
    expect(accountRegisterSchema.safeParse(valid).success).toBe(true);
    expect(accountRegisterSchema.safeParse({ ...valid, email: "not-an-email" }).success).toBe(false);
    expect(accountRegisterSchema.safeParse({ ...valid, password: "short", passwordConfirmation: "short" }).success).toBe(false);
    expect(accountRegisterSchema.safeParse({ ...valid, passwordConfirmation: "password-2" }).success).toBe(false);
  });

  it("登录、改密、换邮与管理员状态写操作拒绝多余或不完整字段", () => {
    expect(
      accountLoginSchema.safeParse({ email: "user@example.com", password: "password-1", roomPassword: "1234" }).success
    ).toBe(true);
    expect(
      accountPasswordChangeSchema.safeParse({
        currentPassword: "password-1",
        newPassword: "password-2",
        newPasswordConfirmation: "password-2"
      }).success
    ).toBe(true);
    expect(accountEmailChangeSchema.safeParse({ currentPassword: "password-1", newEmail: "next@example.com" }).success).toBe(true);
    expect(
      adminAccountsSetStatusSchema.safeParse({ playerId: "p1", status: "deleted", reason: "test" }).success
    ).toBe(false);
  });

  it("公开资料允许替换头像、恢复默认，并拒绝非图片 data URL", () => {
    expect(
      accountProfileUpdateSchema.safeParse({
        nickname: "玩家一",
        avatar: "data:image/png;base64,AA=="
      }).success
    ).toBe(true);
    expect(accountProfileUpdateSchema.safeParse({ nickname: "玩家一", avatar: null }).success).toBe(true);
    expect(
      accountProfileUpdateSchema.safeParse({ nickname: "玩家一", avatar: "https://example.com/avatar.png" }).success
    ).toBe(false);
  });
});
