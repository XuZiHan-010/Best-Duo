import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerSessionStore, ROTATION_GRACE_MS } from "../src/auth/playerSessions.js";

describe("PlayerSessionStore", () => {
  let store: PlayerSessionStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = new PlayerSessionStore();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("issues distinct credentials that verify back to the seat", () => {
    const first = store.issue("A");
    const second = store.issue("B");

    expect(first.playerId).toBeTruthy();
    expect(first.reconnectToken).toBeTruthy();
    expect(first.playerId).not.toBe(second.playerId);
    expect(first.reconnectToken).not.toBe(second.reconnectToken);

    expect(store.verify(first.playerId, first.reconnectToken)).toBe("A");
    expect(store.verify(second.playerId, second.reconnectToken)).toBe("B");
    expect(store.seatOf(first.playerId)).toBe("A");
  });

  it("rejects wrong tokens and unknown player ids", () => {
    const cred = store.issue("A");

    expect(store.verify(cred.playerId, "forged-token")).toBeNull();
    expect(store.verify("unknown-player", cred.reconnectToken)).toBeNull();
  });

  it("keeps the previous token valid within the rotation grace window only", () => {
    const cred = store.issue("A");
    const rotated = store.rotate(cred.playerId);

    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(cred.reconnectToken);
    expect(store.verify(cred.playerId, rotated!)).toBe("A");
    // 宽限期内旧令牌仍可用
    expect(store.verify(cred.playerId, cred.reconnectToken)).toBe("A");

    vi.advanceTimersByTime(ROTATION_GRACE_MS + 1);
    expect(store.verify(cred.playerId, cred.reconnectToken)).toBeNull();
    expect(store.verify(cred.playerId, rotated!)).toBe("A");
  });

  it("rotate returns null for unknown player ids", () => {
    expect(store.rotate("unknown-player")).toBeNull();
  });

  it("revoke, revokeBySeat and revokeAll invalidate sessions", () => {
    const a = store.issue("A");
    const b = store.issue("B");
    const c = store.issue("C");

    store.revoke(a.playerId);
    expect(store.verify(a.playerId, a.reconnectToken)).toBeNull();

    store.revokeBySeat("B");
    expect(store.verify(b.playerId, b.reconnectToken)).toBeNull();

    store.revokeAll();
    expect(store.verify(c.playerId, c.reconnectToken)).toBeNull();
    expect(store.seatOf(c.playerId)).toBeNull();
  });

  it("re-issuing a seat invalidates the previous session for that seat", () => {
    const first = store.issue("A");
    const second = store.issue("A");

    expect(store.verify(first.playerId, first.reconnectToken)).toBeNull();
    expect(store.verify(second.playerId, second.reconnectToken)).toBe("A");
  });

  it("tracks admin sessions and forgets them on revoke", () => {
    expect(store.findAdminPlayerId()).toBeNull();

    const admin = store.issue("A", { isAdmin: true });
    const normal = store.issue("B");

    expect(store.isAdmin(admin.playerId)).toBe(true);
    expect(store.isAdmin(normal.playerId)).toBe(false);
    expect(store.findAdminPlayerId()).toBe(admin.playerId);

    store.revoke(admin.playerId);
    expect(store.findAdminPlayerId()).toBeNull();
    expect(store.isAdmin(admin.playerId)).toBe(false);
  });

  it("账号会话必须匹配当前 credentialVersion", () => {
    const cred = store.issue("A", { playerId: "account-1", credentialVersion: 3 });
    expect(store.verify(cred.playerId, cred.reconnectToken, 3)).toBe("A");
    expect(store.credentialVersionOf(cred.playerId)).toBe(3);
    expect(store.verify(cred.playerId, cred.reconnectToken, 4)).toBeNull();
    expect(store.seatOf(cred.playerId)).toBeNull();
  });
});
