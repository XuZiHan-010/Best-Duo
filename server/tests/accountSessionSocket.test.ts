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
  type AccountActionResultPayload,
  type AccountProfilePayload,
  type AccountSessionPayload,
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

const EMAIL_KEY = Buffer.alloc(32, 19).toString("base64");
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

describe("独立账号会话 Socket", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let dataDir: string;
  let accountStore: AccountStore;
  let room: ReturnType<typeof createGameRoom>;

  const newClient = (auth?: Record<string, string>) => {
    const socket = createClient(url, {
      auth,
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    clients.push(socket);
    return socket;
  };

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-account-session-"));
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

  afterEach(() => {
    clearAllTimers(room);
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("房间已满时仍签发账号会话，且未占座也能恢复并修改公开资料", async () => {
    const registered = await accountStore.register({
      email: "account-only@example.com",
      password: "password-1",
      nickname: "AccountOnly",
      avatar: null
    });
    if (!registered.ok) throw new Error("registration failed");

    room.seats.forEach((seat, index) => {
      seat.kind = "agent";
      seat.nick = `Agent ${index + 1}`;
      seat.connected = true;
    });

    const login = newClient();
    login.connect();
    await once(login, "connect");
    const accountSessionPromise = waitForEvent<AccountSessionPayload>(login, ServerEvents.AccountSession);
    const roomErrorPromise = waitForEvent<{ code: string }>(login, ServerEvents.RoomError);
    login.emit(ClientEvents.AccountLogin, {
      email: "account-only@example.com",
      password: "password-1",
      roomPassword: config.roomPassword
    });

    const accountSession = await accountSessionPromise;
    expect((await roomErrorPromise).code).toBe("ROOM_FULL");
    expect(room.seats.some((seat) => seat.playerId === registered.account.playerId)).toBe(false);

    login.disconnect();
    const restored = newClient({
      accountPlayerId: accountSession.playerId,
      accountToken: accountSession.accountToken
    });
    const profilePromise = waitForEvent<AccountProfilePayload>(restored, ServerEvents.AccountProfile);
    restored.connect();
    await once(restored, "connect");
    expect(await profilePromise).toMatchObject({
      playerId: registered.account.playerId,
      nickname: "AccountOnly",
      email: "account-only@example.com"
    });

    const actionPromise = waitForEvent<AccountActionResultPayload>(restored, ServerEvents.AccountActionResult);
    const avatar = "data:image/png;base64,AA==";
    restored.emit(ClientEvents.AccountProfileUpdate, { nickname: "AccountRenamed", avatar });
    expect(await actionPromise).toMatchObject({ action: "profileUpdate", success: true });
    expect(accountStore.getProfile(registered.account.playerId)?.nickname).toBe("AccountRenamed");
    expect(accountStore.getProfile(registered.account.playerId)?.avatar).toBe(avatar);
    expect(room.seats.some((seat) => seat.playerId === registered.account.playerId)).toBe(false);
  });
});
