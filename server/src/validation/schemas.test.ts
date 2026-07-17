import { describe, expect, it } from "vitest";
import { playerJoinSchema } from "./schemas.js";

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
