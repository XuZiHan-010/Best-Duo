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
  type PlayerSessionPayload,
  type ProgressState,
  type PublicRoomState,
  type SeatId
} from "@take-time/shared";
import { config, defaultSettings } from "../src/config.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { createGameRoom } from "../src/game/room.js";
import { canSolveDeal, type SolverCard } from "../src/game/solver.js";
import { clearAllTimers } from "../src/game/timers.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { createAccountStore, type AccountStore } from "../src/auth/accountStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const TEST_ACCOUNT_PASSWORD = "test-pass";

const joinPayload = (nick: string, extra: Record<string, unknown> = {}) => ({
  nick,
  password: config.roomPassword,
  accountPassword: TEST_ACCOUNT_PASSWORD,
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

describe("socket flow", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let saveImpl: (nextProgress: ProgressState) => Promise<void>;
  let agentRegistry: InMemoryAgentRegistry;
  let accountDir: string;
  let accountStore: AccountStore;

  const levels = loadLevels();
  const savedProgress: ProgressState[] = [];
  const progressStore: ProgressStore = {
    load: () => progress,
    save: async (nextProgress) => {
      await saveImpl(nextProgress);
    },
    flushSync: (nextProgress) => {
      savedProgress.push(structuredClone(nextProgress));
    }
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

  const joinTwoPlayers = async () => {
    const alice = await connectClient();
    const bob = await connectClient();

    const aliceSessionPromise = waitForEvent<PlayerSessionPayload>(alice, ServerEvents.PlayerSession);
    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    await waitForEvent(alice, ServerEvents.RoomState);
    const bobSessionPromise = waitForEvent<PlayerSessionPayload>(bob, ServerEvents.PlayerSession);
    // Bob 入座会向 Alice 广播一份 room:state；返回前把它也消费掉，
    // 避免后续 waitForEvent(alice, RoomState) 抓到这份陈旧广播。
    const aliceSawBobPromise = waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerJoin, joinPayload("Bob"));
    await waitForEvent(bob, ServerEvents.RoomState);
    await aliceSawBobPromise;

    return { alice, bob, aliceSession: await aliceSessionPromise, bobSession: await bobSessionPromise };
  };

  const joinPlayers = async (nicks: string[]) => {
    const sockets: ClientSocket[] = [];
    for (const nick of nicks) {
      const socket = await connectClient();
      socket.emit(ClientEvents.PlayerJoin, joinPayload(nick));
      await waitForEvent(socket, ServerEvents.RoomState);
      sockets.push(socket);
    }
    return sockets;
  };

  const readyAndEnterLevelWithPlayers = async (sockets: ClientSocket[]) => {
    for (const socket of sockets) {
      socket.emit(ClientEvents.PlayerReady);
      await waitForEvent(socket, ServerEvents.RoomState);
    }
    const host = sockets[0];
    host.emit(ClientEvents.GameStart);
    await waitForEvent(host, ServerEvents.RoomState);
    host.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(host, ServerEvents.RoomState);
    host.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(host, ServerEvents.RoomState);
  };

  const placeCurrentDealSuccessfullyWithPlayers = async (sockets: ClientSocket[]) => {
    if (!room.currentChallenge) throw new Error("No current challenge");
    const seatIds = room.seats.filter((seat) => seat.nick).map((seat) => seat.id);
    const socketBySeat = new Map<SeatId, ClientSocket>(seatIds.map((seatId, index) => [seatId, sockets[index]]));
    const cards = seatIds.flatMap((seatId) =>
      (room.hands[seatId] ?? []).map<SolverCard>((card) => ({
        id: card.id,
        owner: card.owner,
        value: card.value,
        color: card.color
      }))
    );
    const solution = canSolveDeal(room.currentChallenge, cards, seatIds);
    expect(solution.solvable).toBe(true);
    expect(solution.assignments).toHaveLength(cards.length);

    const segmentByCardId = new Map(cards.map((card, index) => [card.id, solution.assignments![index]]));
    while (room.phase === "placing") {
      const seatId = room.turn === "race" ? seatIds[0] : room.turn;
      if (!seatId) throw new Error(`Unexpected turn ${room.turn}`);
      const socket = socketBySeat.get(seatId);
      if (!socket) throw new Error(`No socket for ${seatId}`);
      const card = room.hands[seatId]?.find((candidate) => segmentByCardId.has(candidate.id));
      if (!card) throw new Error(`No solvable card for ${seatId}`);
      const segment = segmentByCardId.get(card.id);
      if (segment === undefined) throw new Error(`No segment for ${card.id}`);

      socket.emit(ClientEvents.CardPlace, { cardId: card.id, segment });
      await waitForEvent(socket, ServerEvents.RoomState);
      socket.emit(ClientEvents.HintDecide, { decision: "no" });
      await waitForEvent(socket, ServerEvents.RoomState);
    }
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

  const placeCurrentDealSuccessfully = async (alice: ClientSocket, bob: ClientSocket) => {
    if (!room.currentChallenge) throw new Error("No current challenge");
    const sockets = { A: alice, B: bob };
    const cards = (["A", "B"] as const).flatMap((seatId) =>
      (room.hands[seatId] ?? []).map<SolverCard>((card) => ({
        id: card.id,
        owner: card.owner,
        value: card.value,
        color: card.color
      }))
    );
    const solution = canSolveDeal(room.currentChallenge, cards, ["A", "B"]);
    expect(solution.solvable).toBe(true);
    expect(solution.assignments).toHaveLength(cards.length);

    const segmentByCardId = new Map(cards.map((card, index) => [card.id, solution.assignments![index]]));
    while (room.phase === "placing") {
      const seatId = room.turn === "race" ? "A" : room.turn;
      if (seatId !== "A" && seatId !== "B") throw new Error(`Unexpected turn ${seatId}`);
      const card = room.hands[seatId]?.find((candidate) => segmentByCardId.has(candidate.id));
      if (!card) throw new Error(`No solvable card for ${seatId}`);
      const segment = segmentByCardId.get(card.id);
      if (segment === undefined) throw new Error(`No segment for ${card.id}`);

      sockets[seatId].emit(ClientEvents.CardPlace, { cardId: card.id, segment });
      await waitForEvent(sockets[seatId], ServerEvents.RoomState);
      sockets[seatId].emit(ClientEvents.HintDecide, { decision: "no" });
      await waitForEvent(sockets[seatId], ServerEvents.RoomState);
    }
  };

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels);
    savedProgress.length = 0;
    agentRegistry = new InMemoryAgentRegistry();
    saveImpl = async (nextProgress) => {
      savedProgress.push(structuredClone(nextProgress));
    };

    accountDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sock-accounts-"));
    accountStore = createAccountStore(accountDir);

    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      registerHandlers({ io, socket, room, levels, progressStore, agentRegistry, accountStore });
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
    fs.rmSync(accountDir, { recursive: true, force: true });
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

  it("skips the hint decision window when no hint markers remain", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);
    room.hintMarkers.used = room.hintMarkers.total;

    alice.emit(ClientEvents.CardPlace, { cardId: room.hands.A![0].id, segment: 0 });
    const state = await waitForEvent<PublicRoomState>(alice, ServerEvents.RoomState);

    expect(state.pendingHint).toBeNull();
    expect(state.turn).toBe("B");
    expect(room.pendingHint).toBeNull();
    expect(room.timers.hint).toBeUndefined();
    expect(room.timer?.kind).toBe("turn");
  });

  it("includes level summaries in public room state", async () => {
    const alice = await connectClient();

    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    const state = await waitForEvent<PublicRoomState>(alice, ServerEvents.RoomState);

    expect(state.levelSummaries).toHaveLength(levels.length);
    expect(state.levelSummaries[0]).toMatchObject({
      id: "level-01",
      levelIndex: 1,
      difficulty: "★",
      playable: true
    });
    expect(state.levelSummaries[0].centerCap).toBe("inf");
    expect(state.levelSummaries[0].conditions).toHaveLength(4);
    expect(state.levelSummaries[0].conditions).toContainEqual({ type: "segment-colors", segment: 0, black: 0, white: 1 });
    expect(state.levelSummaries[0].conditions).toContainEqual({ type: "exact-cards", segment: 5, count: 3 });
    expect(state.levelSummaries[0].conditions).toContainEqual({ type: "non-decreasing", segments: [0, 1, 2, 3, 4, 5] });
    expect(state.levelSummaries[0].conditions).toContainEqual({ type: "all-nonempty" });
    expect(state.levelSummaries[0].conditions.some((condition) => condition.type === "max-sum-each")).toBe(false);
  });

  it("rejects joins with the wrong room password without occupying a seat", async () => {
    const alice = await connectClient();

    alice.emit(ClientEvents.PlayerJoin, { nick: "Alice", password: "wrong", accountPassword: TEST_ACCOUNT_PASSWORD });
    const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);

    expect(error.code).toBe("INVALID_ROOM_PASSWORD");
    expect(error.message).toBe("房间密码错误");
    expect(room.seats.every((seat) => !seat.nick && !seat.avatar)).toBe(true);
  });

  it("broadcasts uploaded avatars and assigns a default avatar when omitted", async () => {
    const alice = await connectClient();
    const uploadedAvatar = "data:image/png;base64,QUJD";

    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice", { avatar: uploadedAvatar }));
    await waitForEvent(alice, ServerEvents.RoomState);

    const bob = await connectClient();
    bob.emit(ClientEvents.PlayerJoin, joinPayload("Bob"));
    const state = await waitForEvent<PublicRoomState>(bob, ServerEvents.RoomState);

    const aliceSeat = state.seats.find((seat) => seat.nick === "Alice");
    const bobSeat = state.seats.find((seat) => seat.nick === "Bob");
    expect(aliceSeat?.avatar).toBe(uploadedAvatar);
    expect(bobSeat?.avatar).toMatch(/^\/images\/avatar(?:1jpg|2)\.jpg$/);
  });

  it("assigns different default avatars to two players", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await waitForCondition(() => room.seats.filter((seat) => seat.nick).length === 2);

    const avatars = room.seats.filter((seat) => seat.nick).map((seat) => seat.avatar);
    expect(avatars).toHaveLength(2);
    expect(avatars).toEqual(expect.arrayContaining(["/images/avatar1jpg.jpg", "/images/avatar2.jpg"]));
    expect(new Set(avatars).size).toBe(2);
    expect(alice.connected).toBe(true);
    expect(bob.connected).toBe(true);
  });

  it("allows up to four players in waiting and rejects the fifth", async () => {
    const sockets = [] as ClientSocket[];
    for (const nick of ["Alice", "Bob", "Carol", "Dave"]) {
      const socket = await connectClient();
      sockets.push(socket);
      socket.emit(ClientEvents.PlayerJoin, joinPayload(nick));
      await waitForEvent(socket, ServerEvents.RoomState);
    }

    expect(room.seats.map((seat) => seat.nick)).toEqual(["Alice", "Bob", "Carol", "Dave"]);
    expect(room.seats.every((seat) => seat.connected)).toBe(true);

    const erin = await connectClient();
    erin.emit(ClientEvents.PlayerJoin, joinPayload("Erin"));
    const error = await waitForEvent<{ code: string; message: string }>(erin, ServerEvents.RoomError);

    expect(error.code).toBe("ROOM_FULL");
    expect(error.message).toBe("房间已满");
    expect(room.seats.some((seat) => seat.nick === "Erin")).toBe(false);
    expect(sockets).toHaveLength(4);
  });
  it("lets the host add and remove an agent in waiting", async () => {
    const alice = await connectClient();
    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);

    alice.emit(ClientEvents.HostAddAgent);
    await waitForEvent(alice, ServerEvents.RoomState);

    const agentSeat = room.seats.find((seat) => seat.kind === "agent");
    expect(agentSeat).toBeDefined();
    expect(agentSeat?.nick).toBe("AI-1");
    expect(agentSeat?.connected).toBe(true);
    expect(agentSeat?.agentId).toBeDefined();
    expect(agentRegistry.size).toBe(1);
    expect(room.ready[agentSeat!.id]).toBe(true);

    alice.emit(ClientEvents.HostRemoveAgent, { seatId: agentSeat!.id });
    await waitForEvent(alice, ServerEvents.RoomState);

    expect(agentRegistry.size).toBe(0);
    expect(room.seats.find((seat) => seat.id === agentSeat!.id)).toMatchObject({
      kind: "human",
      nick: null,
      connected: false
    });
  });

  it("allows one ready human plus one agent to start", async () => {
    const alice = await connectClient();
    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostAddAgent);
    await waitForEvent(alice, ServerEvents.RoomState);

    alice.emit(ClientEvents.GameStart);
    await waitForEvent(alice, ServerEvents.RoomState);

    expect(room.phase).toBe("levelSelect");
    expect(room.seats.filter((seat) => seat.nick)).toHaveLength(2);
  });
  it("rejects oversized avatars in join payloads", async () => {
    const alice = await connectClient();
    const oversizedAvatar = `data:image/png;base64,${"A".repeat(300_000)}`;

    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice", { avatar: oversizedAvatar }));
    const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);

    expect(error.code).toBe("bad-request");
    expect(room.seats.every((seat) => !seat.nick && !seat.avatar)).toBe(true);
  });

  it("rejects invalid avatar data URLs in join payloads", async () => {
    const alice = await connectClient();

    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice", { avatar: "https://example.test/avatar.png" }));
    const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);

    expect(error.code).toBe("bad-request");
    expect(room.seats.every((seat) => !seat.nick && !seat.avatar)).toBe(true);
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

  it("does not hand off a disconnected player's turn during a socket game", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    const cardId = room.hands.A![0].id;
    alice.emit(ClientEvents.CardPlace, { cardId, segment: 0 });
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HintDecide, { decision: "no" });
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.turn).toBe("B");

    bob.disconnect();
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.connected === false);

    expect(room.pendingHint).toBeNull();
    expect(room.turn).toBe("B");
    expect(room.placements.flat().some((card) => card.owner === "B")).toBe(false);
    expect(room.timer?.kind).toBe("turn");
  });

  it("keeps the active turn deadline when a player refreshes and reconnects", async () => {
    const { alice, bob, bobSession } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    const originalDeadline = room.timer?.deadline;
    expect(room.timer?.kind).toBe("turn");
    expect(originalDeadline).toBeDefined();

    bob.disconnect();
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.connected === false);
    expect(room.timer?.deadline).toBe(originalDeadline);

    const reconnectedBob = await connectClient({
      playerId: bobSession.playerId,
      reconnectToken: bobSession.reconnectToken
    });
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.socketId === reconnectedBob.id);

    expect(room.timer?.kind).toBe("turn");
    expect(room.timer?.deadline).toBe(originalDeadline);
  });

  it("resets the active game when a disconnected player misses the reconnect window", async () => {
    const mutableConfig = config as { seatHoldMs: number };
    const originalSeatHoldMs = mutableConfig.seatHoldMs;
    mutableConfig.seatHoldMs = 50;
    try {
      const { alice, bob } = await joinTwoPlayers();
      await readyAndEnterLevel(alice, bob);

      expect(room.phase).toBe("placing");
      expect(room.currentChallenge?.levelIndex).toBe(1);
      expect(room.hands.A).toHaveLength(6);

      alice.disconnect();
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);
      expect(room.phase).toBe("placing");

      await waitForCondition(() => room.phase === "waiting" && room.seats.every((seat) => !seat.nick), 1_000);

      expect(room.currentChallenge).toBeNull();
      expect(room.currentLevelIndex).toBeNull();
      expect(room.hands).toEqual({});
      expect(room.progress.clearedLevels).toEqual([]);

      const carol = await connectClient();
      carol.emit(ClientEvents.PlayerJoin, joinPayload("Carol"));
      await waitForEvent(carol, ServerEvents.RoomState);
      expect(room.seats.find((seat) => seat.id === "A")?.nick).toBe("Carol");
    } finally {
      mutableConfig.seatHoldMs = originalSeatHoldMs;
    }
  });

  it("returns to waiting and keeps the other player when the level-select host misses reconnect", async () => {
    const mutableConfig = config as { seatHoldMs: number };
    const originalSeatHoldMs = mutableConfig.seatHoldMs;
    mutableConfig.seatHoldMs = 50;
    try {
      const { alice, bob } = await joinTwoPlayers();
      alice.emit(ClientEvents.PlayerReady);
      await waitForEvent(alice, ServerEvents.RoomState);
      bob.emit(ClientEvents.PlayerReady);
      await waitForEvent(bob, ServerEvents.RoomState);
      alice.emit(ClientEvents.GameStart);
      await waitForEvent(alice, ServerEvents.RoomState);

      expect(room.phase).toBe("levelSelect");
      expect(room.host).toBe("A");

      alice.disconnect();
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);
      await waitForCondition(() => room.phase === "waiting" && room.seats.find((seat) => seat.id === "A")?.nick === null);

      expect(room.host).toBe("B");
      expect(room.ready.B).toBe(true);
      expect(room.seats.find((seat) => seat.id === "B")?.nick).toBe("Bob");
      expect(room.seats.find((seat) => seat.id === "B")?.connected).toBe(true);
      expect(room.currentChallenge).toBeNull();
      expect(room.currentLevelIndex).toBeNull();

      const rejoinedAlice = await connectClient();
      rejoinedAlice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
      await waitForEvent(rejoinedAlice, ServerEvents.RoomState);

      expect(room.phase).toBe("waiting");
      expect(room.seats.some((seat) => seat.nick === "Alice")).toBe(true);
      expect(room.seats.some((seat) => seat.nick === "Bob")).toBe(true);
    } finally {
      mutableConfig.seatHoldMs = originalSeatHoldMs;
    }
  });

  it("returns to waiting and keeps the other player when the result host misses reconnect before next level", async () => {
    const mutableConfig = config as { seatHoldMs: number };
    const originalSeatHoldMs = mutableConfig.seatHoldMs;
    mutableConfig.seatHoldMs = 50;
    try {
      const { alice, bob } = await joinTwoPlayers();
      await readyAndEnterLevel(alice, bob);
      await placeCurrentDealSuccessfully(alice, bob);
      expect(room.phase).toBe("reveal");

      alice.emit(ClientEvents.GameContinueToResult);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.phase).toBe("result");
      expect(room.revealResult?.pass).toBe(true);

      alice.disconnect();
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);
      await waitForCondition(() => room.phase === "waiting" && room.seats.find((seat) => seat.id === "A")?.nick === null);

      expect(room.host).toBe("B");
      expect(room.seats.find((seat) => seat.id === "B")?.nick).toBe("Bob");
      expect(room.seats.find((seat) => seat.id === "B")?.connected).toBe(true);
      expect(room.currentChallenge).toBeNull();
      expect(room.currentLevelIndex).toBeNull();
      expect(room.hands).toEqual({});

      const rejoinedAlice = await connectClient();
      rejoinedAlice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
      await waitForEvent(rejoinedAlice, ServerEvents.RoomState);

      expect(room.phase).toBe("waiting");
      expect(room.seats.some((seat) => seat.nick === "Alice")).toBe(true);
      expect(room.seats.some((seat) => seat.nick === "Bob")).toBe(true);
    } finally {
      mutableConfig.seatHoldMs = originalSeatHoldMs;
    }
  });

  it("reconnects a held seat from handshake auth and sends private hand", async () => {
    const { alice, bob, bobSession } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);
    expect(room.hands.B).toHaveLength(6);

    bob.disconnect();
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.connected === false);

    const reconnectedBob = createClient(url, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      auth: { playerId: bobSession.playerId, reconnectToken: bobSession.reconnectToken },
      transports: ["websocket"]
    });
    clients.push(reconnectedBob);
    const handPromise = waitForEvent(reconnectedBob, ServerEvents.PlayerHand);
    reconnectedBob.connect();
    await once(reconnectedBob, "connect");
    const hand = await handPromise;

    expect(room.seats.find((seat) => seat.id === "B")?.connected).toBe(true);
    expect(room.seats.find((seat) => seat.id === "B")?.socketId).toBe(reconnectedBob.id);
    expect(hand).toHaveLength(6);
    expect(room.timer?.kind).toBe("turn");
  });

  it("lets any seated player end the active game and resets only runtime room state", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);
    room.progress.clearedLevels = [1];
    room.settings.discussionMinutes = 10;
    room.progress.settings = room.settings;

    const gameEndedPromise = waitForEvent(alice, ServerEvents.GameEnded);
    const roomStatePromise = waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.GameEnd);
    await gameEndedPromise;
    await roomStatePromise;

    expect(room.phase).toBe("waiting");
    expect(room.seats.every((seat) => !seat.nick && !seat.connected && !seat.socketId)).toBe(true);
    expect(room.ready).toEqual({});
    expect(room.host).toBeNull();
    expect(room.currentLevelIndex).toBeNull();
    expect(room.currentChallenge).toBeNull();
    expect(room.hands).toEqual({});
    expect(room.placements.flat()).toHaveLength(0);
    expect(room.timer).toBeNull();
    expect(room.timers).toEqual({});
    expect(room.progress.clearedLevels).toEqual([1]);
    expect(room.settings.discussionMinutes).toBe(10);

    alice.emit(ClientEvents.PlayerReady);
    const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);
    expect(error.message).toBe("请先加入房间");
  });

  it("rejects game end from an unseated socket", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);
    const unseated = await connectClient();

    unseated.emit(ClientEvents.GameEnd);
    const error = await waitForEvent<{ code: string; message: string }>(unseated, ServerEvents.RoomError);

    expect(error.message).toBe("请先加入房间");
    expect(room.phase).toBe("placing");
  });

  it("releases only the disconnected seat in waiting after the reconnect window", async () => {
    const mutableConfig = config as { seatHoldMs: number };
    const originalSeatHoldMs = mutableConfig.seatHoldMs;
    mutableConfig.seatHoldMs = 50;
    try {
      const { alice, bob } = await joinTwoPlayers();
      alice.emit(ClientEvents.PlayerReady);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.phase).toBe("waiting");
      expect(room.host).toBe("A");

      alice.disconnect();
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.nick === null, 1_000);

      expect(room.phase).toBe("waiting");
      expect(room.host).toBe("B");
      expect(room.seats.find((seat) => seat.id === "B")?.nick).toBe("Bob");
      expect(room.seats.find((seat) => seat.id === "B")?.connected).toBe(true);
    } finally {
      mutableConfig.seatHoldMs = originalSeatHoldMs;
    }
  });

  it("kicks a fully-ready host that does not start in time and promotes another ready player", async () => {
    const mutableConfig = config as { hostStartGraceMs: number };
    const originalHostStartGraceMs = mutableConfig.hostStartGraceMs;
    mutableConfig.hostStartGraceMs = 150;
    try {
      const { alice, bob } = await joinTwoPlayers();
      let bobGameEndedCount = 0;
      bob.on(ServerEvents.GameEnded, () => {
        bobGameEndedCount += 1;
      });

      alice.emit(ClientEvents.PlayerReady);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.host).toBe("A");

      bob.emit(ClientEvents.PlayerReady);
      await waitForEvent(bob, ServerEvents.RoomState);
      await waitForCondition(() => room.ready.A === true && room.ready.B === true);
      expect(room.ready).toMatchObject({ A: true, B: true });

      await waitForEvent(alice, ServerEvents.GameEnded);
      await waitForCondition(() => room.host === "B" && room.seats.find((seat) => seat.id === "A")?.nick === null);

      expect(room.phase).toBe("waiting");
      expect(room.ready.A).toBe(false);
      expect(room.ready.B).toBe(true);
      expect(room.seats.find((seat) => seat.id === "B")?.nick).toBe("Bob");
      expect(bobGameEndedCount).toBe(0);

      alice.emit(ClientEvents.PlayerReady);
      const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);
      expect(error.message).toBe("请先加入房间");
    } finally {
      mutableConfig.hostStartGraceMs = originalHostStartGraceMs;
    }
  });

  it("rejects settings updates when progress persistence fails", async () => {
    const { alice } = await joinTwoPlayers();
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);

    saveImpl = async () => {
      throw new Error("disk full");
    };

    alice.emit(ClientEvents.SettingsUpdate, { discussionMinutes: 10 });
    const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);

    expect(error.code).toBe("bad-request");
    expect(room.settings.discussionMinutes).toBe(5);
    expect(room.progress.settings.discussionMinutes).toBe(5);
    expect(savedProgress).toHaveLength(0);
  });

  it("keeps cleared progress unchanged and reports an error when successful reveal cannot be persisted", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    saveImpl = async (nextProgress) => {
      if (nextProgress.clearedLevels.length > 0) throw new Error("disk full");
      savedProgress.push(structuredClone(nextProgress));
    };

    const errorPromise = waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);
    await placeCurrentDealSuccessfully(alice, bob);

    const error = await errorPromise;
    expect(error.code).toBe("progress-save-failed");
    expect(room.phase).toBe("reveal");
    expect(room.revealResult?.pass).toBe(true);
    expect(room.progress.clearedLevels).not.toContain(1);
    expect(savedProgress.some((entry) => entry.clearedLevels.includes(1))).toBe(false);
  });

  it("a duplicate online nickname with a wrong account password is rejected and cannot take the seat", async () => {
    // ADR-0006：同昵称在线时，只有正确的账号密码才视为本人；
    // 错误密码一律拒绝，原玩家的连接与座位不受任何影响。
    const { alice } = await joinTwoPlayers();
    const aliceSeat = room.seats.find((seat) => seat.nick === "Alice")!;
    const originalSocketId = aliceSeat.socketId;
    const duplicate = await connectClient();

    duplicate.emit(ClientEvents.PlayerJoin, joinPayload("Alice", { accountPassword: "wrong-pass" }));
    const error = await waitForEvent<{ code: string; message: string }>(duplicate, ServerEvents.RoomError);

    expect(error.code).toBe("ACCOUNT_PASSWORD_MISMATCH");
    expect(alice.connected).toBe(true);
    expect(aliceSeat.connected).toBe(true);
    expect(aliceSeat.socketId).toBe(originalSocketId);
    expect(room.seats.filter((seat) => seat.nick === "Alice")).toHaveLength(1);
  });

  it("rejects new players during an active game while still allowing held-seat reconnects", async () => {
    const { alice, bob, bobSession } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    const carol = await connectClient();
    carol.emit(ClientEvents.PlayerJoin, joinPayload("Carol"));
    const error = await waitForEvent<{ code: string; message: string }>(carol, ServerEvents.RoomError);
    expect(error.code).toBe("ROOM_IN_PROGRESS");

    bob.disconnect();
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.connected === false);

    const reconnectedBob = await connectClient({
      playerId: bobSession.playerId,
      reconnectToken: bobSession.reconnectToken
    });
    await waitForCondition(() => room.seats.find((seat) => seat.id === "B")?.socketId === reconnectedBob.id);

    expect(room.seats.find((seat) => seat.id === "B")?.connected).toBe(true);
    expect(room.seats.some((seat) => seat.nick === "Carol")).toBe(false);
  });

  it("fails the active game when a player explicitly leaves", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    bob.emit(ClientEvents.PlayerLeave);
    await waitForEvent(alice, ServerEvents.RoomState);

    expect(room.phase).toBe("result");
    expect(room.failureReason).toBe("player-left");
    expect(room.seats.find((seat) => seat.id === "B")?.nick).toBeNull();
    expect(room.timer).toBeNull();
  });

  it("blocks room reset in production and keeps it available outside production", async () => {
    const { alice } = await joinTwoPlayers();
    room.host = "A";
    room.phase = "levelSelect";

    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      alice.emit(ClientEvents.RoomReset);
      await waitForEvent(alice, ServerEvents.RoomError);
      expect(room.phase).toBe("levelSelect");

      process.env.NODE_ENV = "development";
      alice.emit(ClientEvents.RoomReset);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.phase).toBe("waiting");
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("keeps sequential level locking in production", async () => {
    const { alice } = await joinTwoPlayers();
    room.host = "A";
    room.phase = "levelSelect";

    const originalNodeEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 2 });
      const error = await waitForEvent<{ code: string; message: string }>(alice, ServerEvents.RoomError);

      expect(error.code).toBe("bad-request");
      expect(error.message).toBe("该关卡尚未解锁");
      expect(room.phase).toBe("levelSelect");
      expect(room.currentLevelIndex).toBeNull();
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  it("allows selecting any level outside production for local testing", async () => {
    const { alice } = await joinTwoPlayers();
    room.host = "A";
    room.phase = "levelSelect";

    const originalNodeEnv = process.env.NODE_ENV;
    const originalUnlockAll = process.env.UNLOCK_ALL_LEVELS;
    try {
      process.env.NODE_ENV = "development";
      delete process.env.UNLOCK_ALL_LEVELS;

      alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 2 });
      await waitForEvent(alice, ServerEvents.RoomState);

      expect(room.phase).toBe("discussion");
      expect(room.currentLevelIndex).toBe(2);
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }

      if (originalUnlockAll === undefined) {
        delete process.env.UNLOCK_ALL_LEVELS;
      } else {
        process.env.UNLOCK_ALL_LEVELS = originalUnlockAll;
      }
    }
  });

  it("plays a full successful level, pauses in reveal, then persists cleared progress through result", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    await placeCurrentDealSuccessfully(alice, bob);

    expect(room.phase).toBe("reveal");
    expect(room.revealResult?.pass).toBe(true);
    expect(room.placements.flat().every((card) => card.revealed)).toBe(true);
    expect(room.progress.clearedLevels).toContain(1);
    expect(savedProgress.at(-1)?.clearedLevels).toContain(1);

    alice.emit(ClientEvents.GameContinueToResult);
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.phase).toBe("result");
  });

  for (const playerCount of [3, 4] as const) {
    it(`plays a full successful level with ${playerCount} human players`, async () => {
      const sockets = await joinPlayers(["Alice", "Bob", "Carol", "Dave"].slice(0, playerCount));
      await readyAndEnterLevelWithPlayers(sockets);

      expect(room.hands.A).toHaveLength(12 / playerCount);
      expect(room.hands.B).toHaveLength(12 / playerCount);
      expect(room.hands.C).toHaveLength(12 / playerCount);
      if (playerCount === 4) expect(room.hands.D).toHaveLength(3);

      await placeCurrentDealSuccessfullyWithPlayers(sockets);

      expect(room.phase).toBe("reveal");
      expect(room.revealResult?.pass).toBe(true);
      expect(room.placements.flat()).toHaveLength(12);
      expect(new Set(room.placements.flat().map((card) => card.owner))).toEqual(
        new Set(room.seats.filter((seat) => seat.nick).map((seat) => seat.id))
      );
    });
  }

  for (const agentCount of [1, 3] as const) {
    it(`completes a socket game with one human and ${agentCount} scripted agent(s)`, async () => {
      const alice = await connectClient();
      alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
      await waitForEvent(alice, ServerEvents.RoomState);
      alice.emit(ClientEvents.PlayerReady);
      await waitForEvent(alice, ServerEvents.RoomState);

      for (let index = 0; index < agentCount; index += 1) {
        alice.emit(ClientEvents.HostAddAgent);
        await waitForEvent(alice, ServerEvents.RoomState);
      }

      alice.emit(ClientEvents.GameStart);
      await waitForEvent(alice, ServerEvents.RoomState);
      alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
      await waitForEvent(alice, ServerEvents.RoomState);
      alice.emit(ClientEvents.GameBeginPlacement);
      await waitForEvent(alice, ServerEvents.RoomState);

      const playerCount = agentCount + 1;
      const humanHandSize = 12 / playerCount;
      for (let index = 0; index < humanHandSize; index += 1) {
        expect(room.turn === "race" || room.turn === "A").toBe(true);
        const card = room.hands.A?.[0];
        if (!card) throw new Error("Human has no card to place");
        alice.emit(ClientEvents.CardPlace, { cardId: card.id, segment: index % 6 });
        await waitForEvent(alice, ServerEvents.RoomState);
        alice.emit(ClientEvents.HintDecide, { decision: "no" });
        await waitForEvent(alice, ServerEvents.RoomState);
        expect(room.placements.flat()).toHaveLength((index + 1) * playerCount);
      }

      expect(room.phase).toBe("reveal");
      expect(room.placements.flat()).toHaveLength(12);
      expect(room.seats.filter((seat) => seat.kind === "agent")).toHaveLength(agentCount);
      expect(agentRegistry.size).toBe(agentCount);

      alice.emit(ClientEvents.GameContinueToResult);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.phase).toBe("result");
    });
  }

  it("completes a socket game with two humans and one scripted agent", async () => {
    const [alice, bob] = await joinPlayers(["Alice", "Bob"]);
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerReady);
    await waitForEvent(bob, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostAddAgent);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.GameStart);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);

    const humanSockets: Partial<Record<SeatId, ClientSocket>> = { A: alice, B: bob };
    let humanPlacements = 0;
    while (room.phase === "placing") {
      const seatId = room.turn === "race" ? "A" : room.turn;
      if (seatId !== "A" && seatId !== "B") throw new Error(`Unexpected human turn ${seatId}`);
      const socket = humanSockets[seatId];
      const card = room.hands[seatId]?.[0];
      if (!socket || !card) throw new Error(`Missing socket or card for ${seatId}`);
      socket.emit(ClientEvents.CardPlace, { cardId: card.id, segment: humanPlacements % 6 });
      await waitForEvent(socket, ServerEvents.RoomState);
      socket.emit(ClientEvents.HintDecide, { decision: "no" });
      await waitForEvent(socket, ServerEvents.RoomState);
      humanPlacements += 1;
    }

    expect(humanPlacements).toBe(8);
    expect(room.phase).toBe("reveal");
    expect(room.placements.flat().filter((card) => card.owner === "C")).toHaveLength(4);
    expect(room.placements.flat()).toHaveLength(12);
  });

  it("rejects game:continueToResult from a non-host and keeps the room in reveal", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);

    await placeCurrentDealSuccessfully(alice, bob);

    expect(room.phase).toBe("reveal");

    bob.emit(ClientEvents.GameContinueToResult);
    const error = await waitForEvent<{ code: string; message: string }>(bob, ServerEvents.RoomError);

    expect(error.message).toBe("只有房主可以继续");
    expect(room.phase).toBe("reveal");
  });

  it("ignores a stale seat-hold timeout that fires after the room was reset", async () => {
    // disconnect()'s setTimeout closure captures the Seat object that exists
    // at disconnect time. softResetRoom rebuilds room.seats from scratch, so
    // that closure must not be allowed to mutate the new generation once it
    // fires late.
    const mutableConfig = config as { seatHoldMs: number };
    const originalSeatHoldMs = mutableConfig.seatHoldMs;
    mutableConfig.seatHoldMs = 80;
    try {
      const { alice, bob } = await joinTwoPlayers();
      alice.emit(ClientEvents.PlayerReady);
      await waitForEvent(alice, ServerEvents.RoomState);
      expect(room.host).toBe("A");

      alice.disconnect();
      await waitForCondition(() => room.seats.find((seat) => seat.id === "A")?.connected === false);

      // Reset the room while Alice's seat-hold timeout is still pending.
      bob.emit(ClientEvents.RoomReset);
      await waitForCondition(() => room.phase === "waiting" && room.seats.every((seat) => !seat.nick));

      const carol = await connectClient();
      carol.emit(ClientEvents.PlayerJoin, joinPayload("Carol"));
      await waitForEvent(carol, ServerEvents.RoomState);
      carol.emit(ClientEvents.PlayerReady);
      await waitForEvent(carol, ServerEvents.RoomState);

      expect(room.host).toBe("A");
      expect(room.ready.A).toBe(true);
      expect(room.seats.find((seat) => seat.id === "A")?.nick).toBe("Carol");

      // Wait past the original seat-hold window — the stale timeout, if not
      // invalidated, would fire somewhere in here and steal A's host/ready.
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(room.host).toBe("A");
      expect(room.ready.A).toBe(true);
      expect(room.seats.find((seat) => seat.id === "A")?.nick).toBe("Carol");
    } finally {
      mutableConfig.seatHoldMs = originalSeatHoldMs;
    }
  });

  describe("玩家账号（ADR-0006）", () => {
    it("首次昵称即注册，重进后 playerId 稳定", async () => {
      const first = await connectClient();
      const firstSessionPromise = waitForEvent<PlayerSessionPayload>(first, ServerEvents.PlayerSession);
      first.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
      await waitForEvent(first, ServerEvents.RoomState);
      const firstSession = await firstSessionPromise;

      first.emit(ClientEvents.PlayerLeave);
      await waitForCondition(() => room.seats.every((seat) => seat.nick !== "小明"));
      first.disconnect();

      const again = await connectClient();
      const againSessionPromise = waitForEvent<PlayerSessionPayload>(again, ServerEvents.PlayerSession);
      again.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
      await waitForEvent(again, ServerEvents.RoomState);
      const againSession = await againSessionPromise;

      expect(againSession.playerId).toBe(firstSession.playerId);
    });

    it("正确账号密码可接管在线座位（先附着后断旧连接）", async () => {
      const oldConn = await connectClient();
      oldConn.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
      await waitForEvent(oldConn, ServerEvents.RoomState);
      const seat = room.seats.find((candidate) => candidate.nick === "小明")!;

      const newConn = await connectClient();
      const newSessionPromise = waitForEvent<PlayerSessionPayload>(newConn, ServerEvents.PlayerSession);
      newConn.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
      await waitForEvent(newConn, ServerEvents.RoomState);
      const newSession = await newSessionPromise;

      await waitForCondition(() => !oldConn.connected);
      expect(newSession.seatId).toBe(seat.id);
      expect(room.seats.filter((candidate) => candidate.nick === "小明")).toHaveLength(1);
      expect(seat.connected).toBe(true);
    });

    it("再次登录忽略新头像，沿用注册头像", async () => {
      const dataUrl = "data:image/png;base64,aGk=";
      const first = await connectClient();
      first.emit(ClientEvents.PlayerJoin, joinPayload("小红", { avatar: dataUrl }));
      await waitForEvent(first, ServerEvents.RoomState);
      first.emit(ClientEvents.PlayerLeave);
      await waitForCondition(() => room.seats.every((seat) => seat.nick !== "小红"));
      first.disconnect();

      const again = await connectClient();
      again.emit(ClientEvents.PlayerJoin, joinPayload("小红", { avatar: "data:image/png;base64,Ynll" }));
      await waitForEvent(again, ServerEvents.RoomState);

      expect(room.seats.find((seat) => seat.nick === "小红")?.avatar).toBe(dataUrl);
    });

    it("房间密码错误时不触发隐式注册", async () => {
      const denied = await connectClient();
      denied.emit(ClientEvents.PlayerJoin, joinPayload("新人", { password: "wrong-room" }));
      const deniedError = await waitForEvent<{ code: string; message: string }>(denied, ServerEvents.RoomError);
      expect(deniedError.code).toBe("INVALID_ROOM_PASSWORD");

      // 用正确房间密码 + 不同个人密码重来：若上一步误建了账号，这里会报 ACCOUNT_PASSWORD_MISMATCH
      const joined = await connectClient();
      joined.emit(ClientEvents.PlayerJoin, joinPayload("新人", { accountPassword: "another-pass" }));
      await waitForEvent(joined, ServerEvents.RoomState);
      expect(room.seats.some((seat) => seat.nick === "新人")).toBe(true);
    });

    it("同昵称连续 5 次密码失败触发 ACCOUNT_RATE_LIMITED", async () => {
      const owner = await connectClient();
      owner.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
      await waitForEvent(owner, ServerEvents.RoomState);

      for (let i = 0; i < 5; i += 1) {
        const intruder = await connectClient();
        intruder.emit(ClientEvents.PlayerJoin, joinPayload("小明", { accountPassword: "bad-pass" }));
        const error = await waitForEvent<{ code: string; message: string }>(intruder, ServerEvents.RoomError);
        expect(error.code).toBe("ACCOUNT_PASSWORD_MISMATCH");
      }

      const sixth = await connectClient();
      sixth.emit(ClientEvents.PlayerJoin, joinPayload("小明", { accountPassword: "bad-pass" }));
      const limited = await waitForEvent<{ code: string; message: string }>(sixth, ServerEvents.RoomError);
      expect(limited.code).toBe("ACCOUNT_RATE_LIMITED");
    });

    it("账户文件损坏时 fail-closed：新注册报 ACCOUNT_STORE_UNAVAILABLE", async () => {
      const corruptedDir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-sock-corrupt-"));
      try {
        fs.writeFileSync(path.join(corruptedDir, "accounts.json"), "{broken", "utf8");
        // io.on("connection") 每次连接读取当前 accountStore 变量，替换后新连接走降级仓库
        accountStore = createAccountStore(corruptedDir);

        const blocked = await connectClient();
        blocked.emit(ClientEvents.PlayerJoin, joinPayload("小明"));
        const error = await waitForEvent<{ code: string; message: string }>(blocked, ServerEvents.RoomError);
        expect(error.code).toBe("ACCOUNT_STORE_UNAVAILABLE");
        expect(fs.readFileSync(path.join(corruptedDir, "accounts.json"), "utf8")).toBe("{broken");
      } finally {
        fs.rmSync(corruptedDir, { recursive: true, force: true });
      }
    });
  });
});
