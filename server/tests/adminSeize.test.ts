import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClientEvents,
  ServerEvents,
  type AdminEnterConfirmRequiredPayload,
  type PlayerKickedPayload,
  type PlayerSessionPayload,
  type ProgressState,
  type PublicRoomState,
  type RoomErrorPayload
} from "@take-time/shared";
import { config, defaultSettings } from "../src/config.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { createGameRoom } from "../src/game/room.js";
import { clearAllTimers } from "../src/game/timers.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "test-admin-secret";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [1],
  settings: defaultSettings
};

const joinPayload = (nick: string) => ({ nick, password: config.roomPassword });

const adminLoginPayload = (overrides: Record<string, unknown> = {}) => ({
  username: ADMIN_USERNAME,
  password: ADMIN_PASSWORD,
  nick: "管理员A",
  ...overrides
});

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

const waitForCondition = async (predicate: () => boolean, timeoutMs = 1_500) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
};

describe("admin seize room", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let capturedStates: PublicRoomState[];

  const mutableConfig = config as { adminUsername: string; adminPassword: string };
  const levels = loadLevels();
  const progressStore: ProgressStore = {
    load: () => progress,
    save: async () => undefined,
    flushSync: () => undefined
  };

  const connectClient = async (auth?: Record<string, string>) => {
    const socket = createClient(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      auth,
      transports: ["websocket"]
    });
    socket.connect();
    await once(socket, "connect");
    clients.push(socket);
    socket.on(ServerEvents.RoomState, (state: PublicRoomState) => capturedStates.push(state));
    return socket;
  };

  const joinTwoPlayers = async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const aliceSessionPromise = waitForEvent<PlayerSessionPayload>(alice, ServerEvents.PlayerSession);
    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    await waitForEvent(alice, ServerEvents.RoomState);
    const bobSessionPromise = waitForEvent<PlayerSessionPayload>(bob, ServerEvents.PlayerSession);
    const aliceSawBobPromise = waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerJoin, joinPayload("Bob"));
    await waitForEvent(bob, ServerEvents.RoomState);
    await aliceSawBobPromise;

    return { alice, bob, aliceSession: await aliceSessionPromise, bobSession: await bobSessionPromise };
  };

  const enterPlacing = async (alice: ClientSocket, bob: ClientSocket) => {
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerReady);
    await waitForEvent(bob, ServerEvents.RoomState);
    alice.emit(ClientEvents.GameStart);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.phase).toBe("placing");
  };

  beforeEach(async () => {
    mutableConfig.adminUsername = ADMIN_USERNAME;
    mutableConfig.adminPassword = ADMIN_PASSWORD;
    room = createGameRoom(structuredClone(progress), levels);
    capturedStates = [];
    const agentRegistry = new InMemoryAgentRegistry();

    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      registerHandlers({ io, socket, room, levels, progressStore, agentRegistry });
    });
    httpServer.listen(0);
    await once(httpServer, "listening");
    const address = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    mutableConfig.adminUsername = "";
    mutableConfig.adminPassword = "";
    clearAllTimers(room);
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    await waitForCondition(() => !httpServer.listening).catch(() => undefined);
  });

  it("enters an empty room directly as seated host without confirmation", async () => {
    const admin = await connectClient();
    const sessionPromise = waitForEvent<PlayerSessionPayload>(admin, ServerEvents.PlayerSession);
    const adminSessionPromise = waitForEvent(admin, ServerEvents.AdminSession);

    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const session = await sessionPromise;
    await adminSessionPromise;

    expect(session.seatId).toBe("A");
    expect(room.host).toBe("A");
    const seatA = room.seats.find((seat) => seat.id === "A")!;
    expect(seatA.nick).toBe("管理员A");
    expect(seatA.connected).toBe(true);
    expect(room.phase).toBe("waiting");
  });

  it("requires confirmation when humans are seated and stays side-effect free", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await enterPlacing(alice, bob);
    const versionBefore = room.stateVersion;

    const admin = await connectClient();
    const confirmPromise = waitForEvent<AdminEnterConfirmRequiredPayload>(
      admin,
      ServerEvents.AdminEnterConfirmRequired
    );
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const confirm = await confirmPromise;

    expect(confirm.humanSeatCount).toBe(2);
    expect(confirm.inGame).toBe(true);
    expect(confirm.stateVersion).toBe(versionBefore);
    expect(room.stateVersion).toBe(versionBefore);
    expect(room.phase).toBe("placing");
    expect(alice.connected).toBe(true);
    expect(bob.connected).toBe(true);
  });

  it("seizes the room: kicks everyone, revokes sessions, admin becomes seated host", async () => {
    const { alice, bob, aliceSession } = await joinTwoPlayers();
    await enterPlacing(alice, bob);

    const admin = await connectClient();
    const confirmPromise = waitForEvent<AdminEnterConfirmRequiredPayload>(
      admin,
      ServerEvents.AdminEnterConfirmRequired
    );
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const confirm = await confirmPromise;

    const aliceSeizedPromise = waitForEvent(alice, ServerEvents.GameAdminSeized);
    const aliceKickedPromise = waitForEvent<PlayerKickedPayload>(alice, ServerEvents.PlayerKicked);
    const bobKickedPromise = waitForEvent<PlayerKickedPayload>(bob, ServerEvents.PlayerKicked);
    const adminPlayerSessionPromise = waitForEvent<PlayerSessionPayload>(admin, ServerEvents.PlayerSession);

    admin.emit(ClientEvents.AdminSeizeRoom, { confirmedStateVersion: confirm.stateVersion });

    await aliceSeizedPromise;
    expect((await aliceKickedPromise).reason).toBe("ADMIN_SEIZED_ROOM");
    expect((await bobKickedPromise).reason).toBe("ADMIN_SEIZED_ROOM");
    const adminSession = await adminPlayerSessionPromise;
    await waitForCondition(() => !alice.connected && !bob.connected);

    expect(adminSession.seatId).toBe("A");
    expect(room.phase).toBe("waiting");
    expect(room.host).toBe("A");
    expect(room.seats.filter((seat) => seat.nick)).toHaveLength(1);
    expect(room.seats.find((seat) => seat.id === "A")!.nick).toBe("管理员A");
    expect(room.hands).toEqual({});
    expect(room.placements.flat()).toHaveLength(0);
    expect(room.chat).toEqual([]);
    expect(room.timers).toEqual({});
    expect(room.timer).toBeNull();
    expect(room.ready).toEqual({});
    expect(room.failureReason).toBeNull();
    expect(room.progress.clearedLevels).toEqual([1]);

    // 被清场玩家的旧会话不能再恢复座位
    const returner = await connectClient();
    const revokedError = waitForEvent<RoomErrorPayload>(returner, ServerEvents.RoomError);
    returner.emit(ClientEvents.PlayerJoin, {
      ...joinPayload("Alice"),
      session: { playerId: aliceSession.playerId, reconnectToken: aliceSession.reconnectToken }
    });
    expect((await revokedError).code).toBe("INVALID_PLAYER_SESSION");
  });

  it("rejects a stale confirmedStateVersion and re-sends confirmation info", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await enterPlacing(alice, bob);

    const admin = await connectClient();
    const confirmPromise = waitForEvent<AdminEnterConfirmRequiredPayload>(
      admin,
      ServerEvents.AdminEnterConfirmRequired
    );
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const confirm = await confirmPromise;

    const phaseBefore = room.phase;
    const staleErrorPromise = waitForEvent<RoomErrorPayload>(admin, ServerEvents.RoomError);
    const freshConfirmPromise = waitForEvent<AdminEnterConfirmRequiredPayload>(
      admin,
      ServerEvents.AdminEnterConfirmRequired
    );
    admin.emit(ClientEvents.AdminSeizeRoom, { confirmedStateVersion: confirm.stateVersion - 1 });

    expect((await staleErrorPromise).code).toBe("STALE_ADMIN_ACTION");
    expect((await freshConfirmPromise).stateVersion).toBe(room.stateVersion);
    expect(room.phase).toBe(phaseBefore);
    expect(alice.connected).toBe(true);
    expect(bob.connected).toBe(true);
  });

  it("rejects seize from a socket that has not logged in as admin", async () => {
    const { alice } = await joinTwoPlayers();

    const errorPromise = waitForEvent<RoomErrorPayload>(alice, ServerEvents.RoomError);
    alice.emit(ClientEvents.AdminSeizeRoom, { confirmedStateVersion: room.stateVersion });

    expect((await errorPromise).code).toBe("ADMIN_UNAUTHORIZED");
    expect(room.seats.filter((seat) => seat.nick)).toHaveLength(2);
  });

  it("rate limits repeated failed logins with a uniform error message", async () => {
    const admin = await connectClient();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const errorPromise = waitForEvent<RoomErrorPayload>(admin, ServerEvents.RoomError);
      admin.emit(ClientEvents.AdminLogin, adminLoginPayload({ password: "wrong-password" }));
      const error = await errorPromise;
      expect(error.code).toBe("ADMIN_UNAUTHORIZED");
      expect(error.message).toBe("管理员账号或密码错误");
    }

    const limitedPromise = waitForEvent<RoomErrorPayload>(admin, ServerEvents.RoomError);
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload({ username: "nonexistent", password: "wrong" }));
    expect((await limitedPromise).code).toBe("ADMIN_RATE_LIMITED");
  });

  it("disables admin login when credentials are not configured", async () => {
    mutableConfig.adminUsername = "";
    mutableConfig.adminPassword = "";

    const admin = await connectClient();
    const errorPromise = waitForEvent<RoomErrorPayload>(admin, ServerEvents.RoomError);
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());

    expect((await errorPromise).code).toBe("ADMIN_DISABLED");
  });

  it("restores the admin seat on reconnect without triggering a second seizure", async () => {
    const admin = await connectClient();
    const sessionPromise = waitForEvent<PlayerSessionPayload>(admin, ServerEvents.PlayerSession);
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const session = await sessionPromise;

    admin.disconnect();
    await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);

    const reconnected = createClient(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      auth: { playerId: session.playerId, reconnectToken: session.reconnectToken },
      transports: ["websocket"]
    });
    clients.push(reconnected);
    const nextSessionPromise = waitForEvent<PlayerSessionPayload>(reconnected, ServerEvents.PlayerSession);
    const adminSessionPromise = waitForEvent(reconnected, ServerEvents.AdminSession);
    reconnected.connect();
    await once(reconnected, "connect");

    const nextSession = await nextSessionPromise;
    await adminSessionPromise;

    expect(nextSession.seatId).toBe("A");
    expect(room.host).toBe("A");
    expect(room.seats.find((seat) => seat.id === "A")!.nick).toBe("管理员A");
  });

  it("never leaks the admin username or tokens in public room state", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await enterPlacing(alice, bob);

    const admin = await connectClient();
    const confirmPromise = waitForEvent<AdminEnterConfirmRequiredPayload>(
      admin,
      ServerEvents.AdminEnterConfirmRequired
    );
    admin.emit(ClientEvents.AdminLogin, adminLoginPayload());
    const confirm = await confirmPromise;
    const adminSeatedPromise = waitForEvent<PlayerSessionPayload>(admin, ServerEvents.PlayerSession);
    admin.emit(ClientEvents.AdminSeizeRoom, { confirmedStateVersion: confirm.stateVersion });
    await adminSeatedPromise;
    await waitForCondition(() => room.phase === "waiting" && room.host === "A");

    expect(capturedStates.length).toBeGreaterThan(0);
    for (const state of capturedStates) {
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain(ADMIN_USERNAME);
      expect(serialized).not.toContain(ADMIN_PASSWORD);
      expect(serialized.toLowerCase()).not.toContain("token");
      expect(serialized).not.toContain("playerId");
    }
  });
});
