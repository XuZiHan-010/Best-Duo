import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEvents, ServerEvents, type ProgressState } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

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

describe("socket flow", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;

  const levels = loadLevels();
  const savedProgress: ProgressState[] = [];
  const progressStore: ProgressStore = {
    load: () => progress,
    save: async (nextProgress) => {
      savedProgress.push(structuredClone(nextProgress));
    },
    flushSync: (nextProgress) => {
      savedProgress.push(structuredClone(nextProgress));
    }
  };

  const connectClient = async () => {
    const socket = createClient(url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    });
    await once(socket, "connect");
    clients.push(socket);
    return socket;
  };

  const joinTwoPlayers = async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    alice.emit(ClientEvents.PlayerJoin, { nick: "Alice" });
    await waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerJoin, { nick: "Bob" });
    await waitForEvent(bob, ServerEvents.RoomState);

    return { alice, bob };
  };

  const readyAndEnterLevel = async (alice: ClientSocket, bob: ClientSocket) => {
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
  };

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels.length);
    savedProgress.length = 0;

    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      registerHandlers({ io, socket, room, levels, progressStore });
    });
    httpServer.listen(0);
    await once(httpServer, "listening");
    const address = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    await waitForCondition(() => !httpServer.listening).catch(() => undefined);
  });

  it("rejects invalid card placement without clearing the active turn timer", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    expect(room.phase).toBe("placing");
    expect(room.timer?.kind).toBe("turn");
    expect(room.timers.turn).toBeDefined();

    alice.emit(ClientEvents.CardPlace, { cardId: "not-in-hand", segment: 0 });
    await waitForEvent(alice, ServerEvents.RoomError);

    expect(room.phase).toBe("placing");
    expect(room.timer?.kind).toBe("turn");
    expect(room.timers.turn).toBeDefined();
    expect(room.placements.flat()).toHaveLength(0);
  });

  it("does not allow advancing after a failed result", async () => {
    const { alice } = await joinTwoPlayers();
    room.host = "A";
    room.currentLevelIndex = 1;
    room.phase = "result";
    room.revealResult = {
      pass: false,
      segmentSums: [0, 0, 0, 0, 0, 0],
      segmentCounts: [0, 0, 0, 0, 0, 0],
      conditions: []
    };

    alice.emit(ClientEvents.GameNext);
    await waitForEvent(alice, ServerEvents.RoomError);

    expect(room.currentLevelIndex).toBe(1);
    expect(room.phase).toBe("result");
  });

  it("hands off a disconnected player's turn during a socket game", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    const cardId = room.hands.A![0].id;
    alice.emit(ClientEvents.CardPlace, { cardId, segment: 0 });
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HintDecide, { decision: "no" });
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.turn).toBe("B");

    bob.disconnect();
    await waitForCondition(() => room.placements.flat().some((card) => card.owner === "B"));

    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("A");
  });

  it("plays a full successful level and persists cleared progress", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    const sockets = { A: alice, B: bob };
    while (room.phase === "placing") {
      const seatId = room.turn === "race" ? "A" : room.turn;
      if (seatId !== "A" && seatId !== "B") throw new Error(`Unexpected turn ${seatId}`);
      const card = room.hands[seatId]?.[0];
      if (!card) throw new Error(`No card for ${seatId}`);

      sockets[seatId].emit(ClientEvents.CardPlace, { cardId: card.id, segment: 5 });
      await waitForEvent(sockets[seatId], ServerEvents.RoomState);
      sockets[seatId].emit(ClientEvents.HintDecide, { decision: "no" });
      await waitForEvent(sockets[seatId], ServerEvents.RoomState);
    }

    expect(room.phase).toBe("result");
    expect(room.revealResult?.pass).toBe(true);
    expect(room.progress.clearedLevels).toContain(1);
    expect(savedProgress.at(-1)?.clearedLevels).toContain(1);
  });
});
