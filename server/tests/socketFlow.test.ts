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

const waitForRoomPhase = (socket: ClientSocket, phase: PublicRoomState["phase"], timeoutMs = 1_000) =>
  new Promise<PublicRoomState>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(ServerEvents.RoomState, onState);
      reject(new Error(`Timed out waiting for room phase ${phase}`));
    }, timeoutMs);
    const onState = (state: PublicRoomState) => {
      if (state.phase !== phase) return;
      clearTimeout(timer);
      socket.off(ServerEvents.RoomState, onState);
      resolve(state);
    };
    socket.on(ServerEvents.RoomState, onState);
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
  let accountStore: AccountStore | undefined;

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
    // 大部分游戏流测试走无持久账号的测试基建；账号协议在本文件末尾单独注入 schema v2 仓库。
    accountStore = undefined;

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
      await waitForCondition(() => room.phase === "result");
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

  it("lets any seated player end the active game and returns all occupants to the ready lobby", async () => {
    const { alice, bob } = await joinTwoPlayers();
    await readyAndEnterLevel(alice, bob);
    room.progress.clearedLevels = [1];
    room.settings.discussionMinutes = 10;
    room.progress.settings = room.settings;

    let gameEndedCount = 0;
    alice.on(ServerEvents.GameEnded, () => {
      gameEndedCount += 1;
    });
    bob.on(ServerEvents.GameEnded, () => {
      gameEndedCount += 1;
    });
    const aliceStatePromise = waitForRoomPhase(alice, "waiting");
    const bobStatePromise = waitForRoomPhase(bob, "waiting");
    bob.emit(ClientEvents.GameEnd);
    const [aliceState, bobState] = await Promise.all([aliceStatePromise, bobStatePromise]);

    expect(room.phase).toBe("waiting");
    expect(room.seats.find((seat) => seat.id === "A")).toMatchObject({ nick: "Alice", connected: true });
    expect(room.seats.find((seat) => seat.id === "B")).toMatchObject({ nick: "Bob", connected: true });
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
    expect(aliceState.phase).toBe("waiting");
    expect(bobState.phase).toBe("waiting");
    expect(gameEndedCount).toBe(0);

    alice.emit(ClientEvents.PlayerReady);
    const readyState = await waitForEvent<PublicRoomState>(alice, ServerEvents.RoomState);
    expect(readyState.ready.A).toBe(true);
    expect(readyState.host).toBe("A");
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

  it("无账号测试模式下，同昵称连接被拒且不能接管座位", async () => {
    // ADR-0006：同昵称在线时，只有正确的账号密码才视为本人；
    // 错误密码一律拒绝，原玩家的连接与座位不受任何影响。
    const { alice } = await joinTwoPlayers();
    const aliceSeat = room.seats.find((seat) => seat.nick === "Alice")!;
    const originalSocketId = aliceSeat.socketId;
    const duplicate = await connectClient();

    duplicate.emit(ClientEvents.PlayerJoin, joinPayload("Alice", { accountPassword: "wrong-pass" }));
    const error = await waitForEvent<{ code: string; message: string }>(duplicate, ServerEvents.RoomError);

    expect(error.code).toBe("NICK_IN_USE");
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
        await waitForCondition(() => room.placements.flat().length === (index + 1) * playerCount);
        expect(room.placements.flat()).toHaveLength((index + 1) * playerCount);
      }

      expect(room.phase).toBe("reveal");
      expect(room.placements.flat()).toHaveLength(12);
      expect(room.seats.filter((seat) => seat.kind === "agent")).toHaveLength(agentCount);
      expect(agentRegistry.size).toBe(agentCount);

      alice.emit(ClientEvents.GameContinueToResult);
      await waitForCondition(() => room.phase === "result");
      expect(room.phase).toBe("result");
    });
  }

  it("acknowledges a human hint decision before waiting for a slow agent turn", async () => {
    const alice = await connectClient();
    alice.emit(ClientEvents.PlayerJoin, joinPayload("Alice"));
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostAddAgent);
    await waitForEvent(alice, ServerEvents.RoomState);

    const agentSeat = room.seats.find((seat) => seat.kind === "agent" && seat.agentId);
    if (!agentSeat?.agentId) throw new Error("Missing agent seat");
    let releaseFirstDecision: (() => void) | undefined;
    const firstDecisionGate = new Promise<void>((resolve) => {
      releaseFirstDecision = resolve;
    });
    let firstDecision = true;
    agentRegistry.register(agentSeat.agentId, {
      async decidePlacement() {
        if (firstDecision) {
          firstDecision = false;
          await firstDecisionGate;
        }
        const card = room.hands[agentSeat.id]?.[0];
        if (!card) throw new Error("Agent has no card");
        return { cardId: card.id, segment: 0 };
      },
      async decideHint() {
        return "no";
      }
    });

    alice.emit(ClientEvents.GameStart);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);

    const humanCard = room.hands.A?.[0];
    if (!humanCard) throw new Error("Human has no card");
    alice.emit(ClientEvents.CardPlace, { cardId: humanCard.id, segment: 0 });
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.pendingHint?.seatId).toBe("A");

    const acknowledgement = waitForEvent<PublicRoomState>(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HintDecide, { decision: "no" });
    const state = await acknowledgement;

    expect(state.pendingHint).toBeNull();
    expect(state.turn).toBe(agentSeat.id);
    expect(room.placements.flat()).toHaveLength(1);

    releaseFirstDecision?.();
    await waitForCondition(() => room.placements.flat().length >= 2);
  });

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
      await waitForCondition(
        () => room.phase !== "placing" || room.turn === "race" || room.turn === "A" || room.turn === "B"
      );
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

  describe("邮箱账号（ADR-0007）", () => {
    const emailKey = Buffer.alloc(32, 9).toString("base64");
    const registration = (overrides: Record<string, unknown> = {}) => ({
      email: "alice@example.com",
      password: "password-1",
      passwordConfirmation: "password-1",
      nickname: "小明",
      roomPassword: config.roomPassword,
      ...overrides
    });

    it("显式注册直接入座，离开后用邮箱登录并保持 playerId", async () => {
      accountStore = createAccountStore(accountDir, emailKey);
      const first = await connectClient();
      const firstSessionPromise = waitForEvent<PlayerSessionPayload>(first, ServerEvents.PlayerSession);
      const firstProfilePromise = waitForEvent(first, ServerEvents.AccountProfile);
      const firstStatePromise = waitForEvent(first, ServerEvents.RoomState);
      first.emit(ClientEvents.AccountRegister, registration());
      await firstProfilePromise;
      await firstStatePromise;
      const firstSession = await firstSessionPromise;

      first.emit(ClientEvents.PlayerLeave);
      await waitForCondition(() => room.seats.every((seat) => seat.nick !== "小明"));
      first.disconnect();

      const again = await connectClient();
      const againSessionPromise = waitForEvent<PlayerSessionPayload>(again, ServerEvents.PlayerSession);
      const againProfilePromise = waitForEvent(again, ServerEvents.AccountProfile);
      const againStatePromise = waitForEvent(again, ServerEvents.RoomState);
      again.emit(ClientEvents.AccountLogin, {
        email: "alice@EXAMPLE.COM",
        password: "password-1",
        roomPassword: config.roomPassword
      });
      await againProfilePromise;
      await againStatePromise;
      expect((await againSessionPromise).playerId).toBe(firstSession.playerId);
      expect(room.seats.find((seat) => seat.nick === "小明")?.playerId).toBe(firstSession.playerId);
    });

    it("注册写盘期间房间状态变化时，明确返回账号已创建而不是留下未知结果", async () => {
      const persistedStore = createAccountStore(accountDir, emailKey);
      accountStore = {
        ...persistedStore,
        async register(input) {
          const result = await persistedStore.register(input);
          if (result.ok) room.phase = "discussion";
          return result;
        }
      };
      const player = await connectClient();
      const profilePromise = waitForEvent<{ email: string }>(player, ServerEvents.AccountProfile);
      const actionPromise = waitForEvent<{ action: string; success: boolean; message: string }>(
        player,
        ServerEvents.AccountActionResult
      );
      const errorPromise = waitForEvent<{ code: string; message: string }>(player, ServerEvents.RoomError);

      player.emit(ClientEvents.AccountRegister, registration());

      expect(await profilePromise).toMatchObject({ email: "alice@example.com" });
      expect(await actionPromise).toMatchObject({ action: "register", success: true });
      expect(await errorPromise).toMatchObject({ code: "ACCOUNT_CREATED_ROOM_ENTRY_FAILED" });
      expect(room.seats.every((seat) => !seat.nick)).toBe(true);
      expect((await persistedStore.authenticate({ email: "alice@example.com", password: "password-1" })).ok).toBe(
        true
      );
    });

    it("错误房间密码不创建账号，旧昵称隐式注册入口被拒绝", async () => {
      accountStore = createAccountStore(accountDir, emailKey);
      const denied = await connectClient();
      denied.emit(ClientEvents.AccountRegister, registration({ roomPassword: "wrong-room" }));
      expect((await waitForEvent<{ code: string }>(denied, ServerEvents.RoomError)).code).toBe(
        "INVALID_ROOM_PASSWORD"
      );
      expect(fs.existsSync(path.join(accountDir, "accounts.json"))).toBe(false);

      const legacy = await connectClient();
      legacy.emit(ClientEvents.PlayerJoin, joinPayload("旧入口"));
      expect((await waitForEvent<{ code: string }>(legacy, ServerEvents.RoomError)).code).toBe(
        "ACCOUNT_REGISTRATION_REQUIRED"
      );
    });

    it("改名原子更新座位；改密和换邮换发当前会话并撤销旧令牌", async () => {
      accountStore = createAccountStore(accountDir, emailKey);
      const player = await connectClient();
      const initialSessionPromise = waitForEvent<PlayerSessionPayload>(player, ServerEvents.PlayerSession);
      const initialStatePromise = waitForEvent(player, ServerEvents.RoomState);
      player.emit(ClientEvents.AccountRegister, registration());
      await initialStatePromise;
      const initialSession = await initialSessionPromise;

      const profileActionPromise = waitForEvent(player, ServerEvents.AccountActionResult);
      const profileStatePromise = waitForEvent(player, ServerEvents.RoomState);
      player.emit(ClientEvents.AccountProfileUpdate, { nickname: "新昵称" });
      await profileActionPromise;
      await profileStatePromise;
      expect(room.seats.find((seat) => seat.playerId === initialSession.playerId)?.nick).toBe("新昵称");

      const passwordSessionPromise = waitForEvent<PlayerSessionPayload>(player, ServerEvents.PlayerSession);
      player.emit(ClientEvents.AccountPasswordChange, {
        currentPassword: "password-1",
        newPassword: "password-2",
        newPasswordConfirmation: "password-2"
      });
      const passwordSession = await passwordSessionPromise;
      expect(passwordSession.reconnectToken).not.toBe(initialSession.reconnectToken);

      const stale = await connectClient();
      const staleErrorPromise = waitForEvent<{ code: string }>(stale, ServerEvents.RoomError);
      stale.emit(ClientEvents.PlayerJoin, {
        nick: "新昵称",
        session: { playerId: initialSession.playerId, reconnectToken: initialSession.reconnectToken }
      });
      expect((await staleErrorPromise).code).toBe(
        "INVALID_PLAYER_SESSION"
      );

      const emailSessionPromise = waitForEvent<PlayerSessionPayload>(player, ServerEvents.PlayerSession);
      player.emit(ClientEvents.AccountEmailChange, {
        currentPassword: "password-2",
        newEmail: "next@example.com"
      });
      const emailSession = await emailSessionPromise;
      expect(emailSession.reconnectToken).not.toBe(passwordSession.reconnectToken);
      expect(accountStore.getProfile(initialSession.playerId)?.email).toBe("next@example.com");
    });

    it("登录失败统一文案并在第六次触发限流", async () => {
      accountStore = createAccountStore(accountDir, emailKey);
      const owner = await connectClient();
      const ownerStatePromise = waitForEvent(owner, ServerEvents.RoomState);
      owner.emit(ClientEvents.AccountRegister, registration());
      await ownerStatePromise;

      for (let index = 0; index < 5; index += 1) {
        const attempt = await connectClient();
        attempt.emit(ClientEvents.AccountLogin, {
          email: "alice@example.com",
          password: "wrong-password",
          roomPassword: config.roomPassword
        });
        const error = await waitForEvent<{ code: string; message: string }>(attempt, ServerEvents.RoomError);
        expect(error).toMatchObject({ code: "ACCOUNT_INVALID_CREDENTIALS", message: "邮箱或密码不正确" });
      }
      const limited = await connectClient();
      limited.emit(ClientEvents.AccountLogin, {
        email: "alice@example.com",
        password: "wrong-password",
        roomPassword: config.roomPassword
      });
      expect((await waitForEvent<{ code: string }>(limited, ServerEvents.RoomError)).code).toBe(
        "ACCOUNT_RATE_LIMITED"
      );
    });

    it("不同邮箱不能绕过连接地址级登录总限流", async () => {
      accountStore = createAccountStore(accountDir, emailKey);
      for (let index = 0; index < 10; index += 1) {
        const attempt = await connectClient();
        attempt.emit(ClientEvents.AccountLogin, {
          email: `missing-${index}@example.com`,
          password: "wrong-password",
          roomPassword: config.roomPassword
        });
        expect((await waitForEvent<{ code: string }>(attempt, ServerEvents.RoomError)).code).toBe(
          "ACCOUNT_INVALID_CREDENTIALS"
        );
      }

      const limited = await connectClient();
      limited.emit(ClientEvents.AccountLogin, {
        email: "missing-final@example.com",
        password: "wrong-password",
        roomPassword: config.roomPassword
      });
      expect((await waitForEvent<{ code: string }>(limited, ServerEvents.RoomError)).code).toBe(
        "ACCOUNT_RATE_LIMITED"
      );
    });
  });
});
