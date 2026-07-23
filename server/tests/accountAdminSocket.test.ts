import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClientEvents,
  ServerEvents,
  type PlayerKickedPayload,
  type PlayerSessionPayload,
  type ProgressState
} from "@take-time/shared";
import { createAccountStore, type AccountStore } from "../src/auth/accountStore.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { config, defaultSettings } from "../src/config.js";
import { createGameRoom } from "../src/game/room.js";
import { clearAllTimers } from "../src/game/timers.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const EMAIL_KEY = Buffer.alloc(32, 11).toString("base64");
const ADMIN_USERNAME = "account-admin";
const ADMIN_PASSWORD = "admin-password-1";
const progress: ProgressState = { schemaVersion: 1, clearedLevels: [], settings: defaultSettings };
const progressStore: ProgressStore = {
  load: () => progress,
  save: async () => undefined,
  flushSync: () => undefined
};

const waitForEvent = <T>(socket: ClientSocket, event: string, timeoutMs = 1_500) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const onEvent = (value: T) => {
      clearTimeout(timer);
      resolve(value);
    };
    socket.once(event, onEvent);
  });

describe("管理员账号维护 Socket", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let dataDir: string;
  let accountStore: AccountStore;
  let room: ReturnType<typeof createGameRoom>;
  const mutableConfig = config as { adminUsername: string; adminPassword: string };

  const connect = async () => {
    const socket = createClient(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    socket.connect();
    await once(socket, "connect");
    clients.push(socket);
    return socket;
  };

  beforeEach(async () => {
    mutableConfig.adminUsername = ADMIN_USERNAME;
    mutableConfig.adminPassword = ADMIN_PASSWORD;
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-account-admin-"));
    accountStore = createAccountStore(dataDir, EMAIL_KEY);
    room = createGameRoom(structuredClone(progress), loadLevels());
    const agentRegistry = new InMemoryAgentRegistry();

    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      registerHandlers({
        io,
        socket,
        room,
        levels: loadLevels(),
        progressStore,
        agentRegistry,
        accountStore
      });
    });
    httpServer.listen(0);
    await once(httpServer, "listening");
    url = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
    clients = [];
  });

  afterEach(async () => {
    mutableConfig.adminUsername = "";
    mutableConfig.adminPassword = "";
    clearAllTimers(room);
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("列表脱敏，并支持强退、停用/恢复、软删除及审计", async () => {
    const registered = await accountStore.register({
      email: "alice@example.com",
      password: "password-1",
      nickname: "Alice",
      avatar: null
    });
    if (!registered.ok) throw new Error("registration failed");
    const playerId = registered.account.playerId;

    const admin = await connect();
    const adminSessionPromise = waitForEvent(admin, ServerEvents.AdminSession);
    admin.emit(ClientEvents.AdminLogin, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      nick: "管理员",
      intent: "manage"
    });
    await adminSessionPromise;
    expect(room.seats.every((seat) => !seat.nick)).toBe(true);

    const player = await connect();
    const playerSessionPromise = waitForEvent<PlayerSessionPayload>(player, ServerEvents.PlayerSession);
    const playerStatePromise = waitForEvent(player, ServerEvents.RoomState);
    player.emit(ClientEvents.AccountLogin, {
      email: "alice@example.com",
      password: "password-1",
      roomPassword: config.roomPassword
    });
    const playerSession = await playerSessionPromise;
    await playerStatePromise;

    const listPromise = waitForEvent<{ accounts: Array<Record<string, unknown>> }>(
      admin,
      ServerEvents.AdminAccountsListResult
    );
    admin.emit(ClientEvents.AdminAccountsList, {});
    const list = await listPromise;
    expect(list.accounts[0]).toMatchObject({
      playerId,
      nickname: "Alice",
      maskedEmail: "a***@example.com",
      emailVerified: false,
      status: "active",
      online: true,
      inSeat: true
    });
    expect(JSON.stringify(list)).not.toContain("alice@example.com");

    const kickedPromise = waitForEvent<PlayerKickedPayload>(player, ServerEvents.PlayerKicked);
    const forceResultPromise = waitForEvent(admin, ServerEvents.AdminActionResult);
    admin.emit(ClientEvents.AdminAccountsForceLogout, { playerId, reason: "安全检查" });
    expect((await kickedPromise).reason).toBe("ACCOUNT_FORCE_LOGOUT");
    await forceResultPromise;

    const stale = await connect();
    const staleErrorPromise = waitForEvent<{ code: string }>(stale, ServerEvents.RoomError);
    stale.emit(ClientEvents.PlayerJoin, {
      nick: "Alice",
      session: { playerId, reconnectToken: playerSession.reconnectToken }
    });
    expect((await staleErrorPromise).code).toBe("INVALID_PLAYER_SESSION");

    const disableResultPromise = waitForEvent(admin, ServerEvents.AdminActionResult);
    admin.emit(ClientEvents.AdminAccountsSetStatus, { playerId, status: "disabled", reason: "临时停用" });
    await disableResultPromise;
    const denied = await connect();
    const deniedPromise = waitForEvent<{ code: string; message: string }>(denied, ServerEvents.RoomError);
    denied.emit(ClientEvents.AccountLogin, {
      email: "alice@example.com",
      password: "password-1",
      roomPassword: config.roomPassword
    });
    expect(await deniedPromise).toMatchObject({
      code: "ACCOUNT_INVALID_CREDENTIALS",
      message: "邮箱或密码不正确"
    });

    const restorePromise = waitForEvent(admin, ServerEvents.AdminActionResult);
    admin.emit(ClientEvents.AdminAccountsSetStatus, { playerId, status: "active", reason: "复核通过" });
    await restorePromise;
    const deletePromise = waitForEvent(admin, ServerEvents.AdminActionResult);
    admin.emit(ClientEvents.AdminAccountsSoftDelete, { playerId, reason: "用户请求" });
    await deletePromise;

    const replacement = await accountStore.register({
      email: "alice@example.com",
      password: "password-2",
      nickname: "Alice",
      avatar: null
    });
    expect(replacement.ok).toBe(true);
    if (replacement.ok) expect(replacement.account.playerId).not.toBe(playerId);

    const audit = fs.readFileSync(path.join(dataDir, "account-admin-audit.jsonl"), "utf8");
    expect(audit).toContain(ADMIN_USERNAME);
    expect(audit).toContain(playerId);
    expect(audit).toContain("forceLogout");
    expect(audit).toContain("setStatus");
    expect(audit).toContain("softDelete");
    expect(audit).toContain('"result":"pending"');
    expect(audit).toContain('"result":"success"');
    expect(audit).not.toContain("alice@example.com");
    expect(audit).not.toContain("password-1");
  });

  it("审计预写不可用时拒绝管理员写操作，不改变账号状态", async () => {
    const persistedStore = accountStore;
    const registered = await persistedStore.register({
      email: "blocked@example.com",
      password: "password-1",
      nickname: "Blocked",
      avatar: null
    });
    if (!registered.ok) throw new Error("registration failed");
    accountStore = {
      ...persistedStore,
      appendAdminAudit: () => false
    };

    const admin = await connect();
    const adminSessionPromise = waitForEvent(admin, ServerEvents.AdminSession);
    admin.emit(ClientEvents.AdminLogin, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      nick: "管理员",
      intent: "manage"
    });
    await adminSessionPromise;
    expect(room.seats.every((seat) => !seat.nick)).toBe(true);

    const errorPromise = waitForEvent<{ code: string }>(admin, ServerEvents.RoomError);
    admin.emit(ClientEvents.AdminAccountsSetStatus, {
      playerId: registered.account.playerId,
      status: "disabled",
      reason: "应被拒绝"
    });

    expect((await errorPromise).code).toBe("ACCOUNT_AUDIT_UNAVAILABLE");
    expect(persistedStore.getByPlayerId(registered.account.playerId)?.status).toBe("active");
  });
});
