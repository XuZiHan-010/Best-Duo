import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClientEvents,
  ServerEvents,
  type PlayerSessionPayload,
  type ProgressState,
  type RoomErrorPayload
} from "@take-time/shared";
import { config, defaultSettings } from "../src/config.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { createGameRoom } from "../src/game/room.js";
import { clearAllTimers } from "../src/game/timers.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const joinPayload = (nick: string, extra: Record<string, unknown> = {}) => ({
  nick,
  password: config.roomPassword,
  ...extra
});

const waitForEvent = <T>(socket: ClientSocket, event: string, timeoutMs = 1_000) =>
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

const waitForCondition = async (predicate: () => boolean, timeoutMs = 1_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
};

describe("player identity flow", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;

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
    return socket;
  };

  // handshake auth 的响应在连接建立瞬间就会到达，监听必须先于 connect 挂好。
  const connectClientExpecting = async <T>(event: string, auth: Record<string, string>) => {
    const socket = createClient(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      auth,
      transports: ["websocket"]
    });
    const eventPromise = waitForEvent<T>(socket, event);
    socket.connect();
    await once(socket, "connect");
    clients.push(socket);
    return { socket, eventPromise };
  };

  const joinAndGetSession = async (socket: ClientSocket, nick: string) => {
    const sessionPromise = waitForEvent<PlayerSessionPayload>(socket, ServerEvents.PlayerSession);
    socket.emit(ClientEvents.PlayerJoin, joinPayload(nick));
    await waitForEvent(socket, ServerEvents.RoomState);
    return sessionPromise;
  };

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels);
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
    clearAllTimers(room);
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    await waitForCondition(() => !httpServer.listening).catch(() => undefined);
  });

  it("issues a private player session on first join", async () => {
    const alice = await connectClient();
    const session = await joinAndGetSession(alice, "Alice");

    expect(session.playerId).toBeTruthy();
    expect(session.reconnectToken).toBeTruthy();
    expect(session.seatId).toBe("A");
  });

  it("rejects a same-nick join without session and keeps the original player intact", async () => {
    const alice = await connectClient();
    await joinAndGetSession(alice, "Alice");

    const attacker = await connectClient();
    const errorPromise = waitForEvent<RoomErrorPayload>(attacker, ServerEvents.RoomError);
    attacker.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    const error = await errorPromise;

    expect(error.code).toBe("NICK_IN_USE");
    // 原玩家不受影响
    expect(alice.connected).toBe(true);
    const seatA = room.seats.find((seat) => seat.id === "A")!;
    expect(seatA.nick).toBe("Alice");
    expect(seatA.connected).toBe(true);
  });

  it("takes over the seat with a valid session and disconnects the old socket afterwards", async () => {
    const alice = await connectClient();
    const session = await joinAndGetSession(alice, "Alice");

    const successor = await connectClient();
    const nextSessionPromise = waitForEvent<PlayerSessionPayload>(successor, ServerEvents.PlayerSession);
    successor.emit(
      ClientEvents.PlayerJoin,
      joinPayload("Alice", { session: { playerId: session.playerId, reconnectToken: session.reconnectToken } })
    );
    const nextSession = await nextSessionPromise;

    expect(nextSession.seatId).toBe("A");
    expect(nextSession.playerId).toBe(session.playerId);
    expect(nextSession.reconnectToken).not.toBe(session.reconnectToken);
    await waitForCondition(() => !alice.connected);
    const seatA = room.seats.find((seat) => seat.id === "A")!;
    expect(seatA.nick).toBe("Alice");
    expect(seatA.connected).toBe(true);
  });

  it("rejects forged and revoked sessions without touching the seat", async () => {
    const alice = await connectClient();
    const session = await joinAndGetSession(alice, "Alice");

    const forger = await connectClient();
    const forgeError = waitForEvent<RoomErrorPayload>(forger, ServerEvents.RoomError);
    forger.emit(
      ClientEvents.PlayerJoin,
      joinPayload("Alice", { session: { playerId: session.playerId, reconnectToken: "forged-token" } })
    );
    expect((await forgeError).code).toBe("INVALID_PLAYER_SESSION");
    expect(alice.connected).toBe(true);

    // 主动离开后会话撤销
    alice.emit(ClientEvents.PlayerLeave);
    await waitForEvent(alice, ServerEvents.RoomState);

    const returner = await connectClient();
    const revokedError = waitForEvent<RoomErrorPayload>(returner, ServerEvents.RoomError);
    returner.emit(
      ClientEvents.PlayerJoin,
      joinPayload("Alice", { session: { playerId: session.playerId, reconnectToken: session.reconnectToken } })
    );
    expect((await revokedError).code).toBe("INVALID_PLAYER_SESSION");
  });

  it("returns stable error codes for password, in-progress and full-room failures", async () => {
    const alice = await connectClient();
    await joinAndGetSession(alice, "Alice");
    const bob = await connectClient();
    await joinAndGetSession(bob, "Bob");

    // 密码错误
    const wrongPassword = await connectClient();
    const passwordError = waitForEvent<RoomErrorPayload>(wrongPassword, ServerEvents.RoomError);
    wrongPassword.emit(ClientEvents.PlayerJoin, { nick: "Carl", password: "wrong-password" });
    expect((await passwordError).code).toBe("INVALID_ROOM_PASSWORD");

    // 对局中禁止新身份
    room.phase = "discussion";
    const lateJoiner = await connectClient();
    const inProgressError = waitForEvent<RoomErrorPayload>(lateJoiner, ServerEvents.RoomError);
    lateJoiner.emit(ClientEvents.PlayerJoin, joinPayload("Carl"));
    expect((await inProgressError).code).toBe("ROOM_IN_PROGRESS");
    room.phase = "waiting";

    // 四座已满
    const carl = await connectClient();
    await joinAndGetSession(carl, "Carl");
    const dave = await connectClient();
    await joinAndGetSession(dave, "Dave");
    const fifth = await connectClient();
    const fullError = waitForEvent<RoomErrorPayload>(fifth, ServerEvents.RoomError);
    fifth.emit(ClientEvents.PlayerJoin, joinPayload("Eve"));
    expect((await fullError).code).toBe("ROOM_FULL");
  });

  it("auto-reconnects from handshake auth and rotates the token", async () => {
    const alice = await connectClient();
    const session = await joinAndGetSession(alice, "Alice");
    alice.disconnect();
    await waitForCondition(() => {
      const seatA = room.seats.find((seat) => seat.id === "A")!;
      return !seatA.connected;
    });

    const { eventPromise } = await connectClientExpecting<PlayerSessionPayload>(ServerEvents.PlayerSession, {
      playerId: session.playerId,
      reconnectToken: session.reconnectToken
    });
    const nextSession = await eventPromise;

    expect(nextSession.seatId).toBe("A");
    expect(nextSession.reconnectToken).not.toBe(session.reconnectToken);
    const seatA = room.seats.find((seat) => seat.id === "A")!;
    expect(seatA.nick).toBe("Alice");
    expect(seatA.connected).toBe(true);
  });

  it("ignores invalid handshake auth without seating anyone", async () => {
    const { eventPromise } = await connectClientExpecting<RoomErrorPayload>(ServerEvents.RoomError, {
      playerId: "ghost",
      reconnectToken: "ghost-token"
    });
    const error = await eventPromise;

    expect(error.code).toBe("INVALID_PLAYER_SESSION");
    expect(room.seats.every((seat) => seat.nick === null)).toBe(true);
  });
});
