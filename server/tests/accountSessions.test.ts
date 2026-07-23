import { describe, expect, it } from "vitest";
import { AccountSessionStore } from "../src/auth/accountSessions.js";

describe("AccountSessionStore", () => {
  it("supports multiple devices and revokeOthers keeps only the current token", () => {
    const store = new AccountSessionStore();
    const first = store.issue("player-1", 3);
    const second = store.issue("player-1", 3);

    expect(store.verify(first.playerId, first.accountToken, 3)).toBe(true);
    expect(store.verify(second.playerId, second.accountToken, 3)).toBe(true);

    store.revokeOthers("player-1", second.accountToken);
    expect(store.verify(first.playerId, first.accountToken, 3)).toBe(false);
    expect(store.verify(second.playerId, second.accountToken, 3)).toBe(true);
  });

  it("rejects a token after credentialVersion changes", () => {
    const store = new AccountSessionStore();
    const session = store.issue("player-1", 1);
    expect(store.verify(session.playerId, session.accountToken, 2)).toBe(false);
    expect(store.verify(session.playerId, session.accountToken, 1)).toBe(false);
  });

  it("revokePlayer does not affect another account", () => {
    const store = new AccountSessionStore();
    const alice = store.issue("alice", 1);
    const bob = store.issue("bob", 1);
    store.revokePlayer("alice");
    expect(store.verify(alice.playerId, alice.accountToken, 1)).toBe(false);
    expect(store.verify(bob.playerId, bob.accountToken, 1)).toBe(true);
  });
});
