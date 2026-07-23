import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEvents, ServerEvents, type ProgressState } from "@take-time/shared";
import { config, defaultSettings } from "../src/config.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { InMemoryAgentRegistry } from "../src/agent/registry.js";
import { MockModelClient } from "../src/agent/modelClient.js";
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

const levels = loadLevels();

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

const waitForCondition = async (predicate: () => boolean, timeoutMs = 3_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for condition");
};

describe("level run lifecycle over sockets", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let agentRegistry: InMemoryAgentRegistry;
  let agentRuntime: AgentRuntime;

  const progressStore: ProgressStore = {
    load: () => progress,
    save: async () => {},
    flushSync: () => {}
  };

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels);
    agentRegistry = new InMemoryAgentRegistry();
    agentRuntime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
        }
        return { content: JSON.stringify({ message: "我建议区6放大牌" }) };
      }),
      discussion: { maxMessagesPerAgent: 1, cooldownMs: 0, delay: async () => {} }
    });

    httpServer = http.createServer();
    io = new Server(httpServer);
    io.on("connection", (socket) => {
      registerHandlers({ io, socket, room, levels, progressStore, agentRegistry, agentRuntime });
    });
    httpServer.listen(0);
    await once(httpServer, "listening");
    const address = httpServer.address() as AddressInfo;
    url = `http://127.0.0.1:${address.port}`;
    clients = [];
  });

  afterEach(async () => {
    agentRuntime.cancelDiscussion();
    clearAllTimers(room);
    for (const client of clients) client.disconnect();
    io.close();
    httpServer.close();
    await waitForCondition(() => !httpServer.listening).catch(() => undefined);
  });

  const connectClient = async () => {
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

  const setupTwoHumansAndAgent = async () => {
    const alice = await connectClient();
    const bob = await connectClient();
    alice.emit(ClientEvents.PlayerJoin, { nick: "Alice", password: config.roomPassword, accountPassword: "test-pass" });
    await waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerJoin, { nick: "Bob", password: config.roomPassword, accountPassword: "test-pass" });
    await waitForEvent(bob, ServerEvents.RoomState);

    alice.emit(ClientEvents.PlayerReady);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostAddAgent);
    await waitForEvent(alice, ServerEvents.RoomState);
    bob.emit(ClientEvents.PlayerReady);
    await waitForEvent(bob, ServerEvents.RoomState);

    alice.emit(ClientEvents.GameStart);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(alice, ServerEvents.RoomState);
    return { alice, bob };
  };

  it("starts a fresh level run without the old retry brief after host goes back to level select", async () => {
    const { alice } = await setupTwoHumansAndAgent();
    const firstLevelRunId = room.identity.levelRunId;
    expect(firstLevelRunId).toBeTruthy();

    // 为当前 levelRun 制造一份失败摘要，模拟这一关此前失败过。
    agentRuntime.memory.finishAttempt({ passedSegments: [], failedSegments: [0] });

    alice.emit(ClientEvents.HostBackToLevelSelect);
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.identity.levelRunId).toBeNull();

    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 1 });
    await waitForEvent(alice, ServerEvents.RoomState);

    expect(room.identity.levelRunId).toBeTruthy();
    expect(room.identity.levelRunId).not.toBe(firstLevelRunId);
    expect(agentRuntime.memory.currentAttempt()?.shared.retryBriefInput).toBeUndefined();
  });

  it("finalizes the attempt with a player-left brief when a player leaves mid-game", async () => {
    const { alice, bob } = await setupTwoHumansAndAgent();

    bob.emit(ClientEvents.PlayerLeave);
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => room.phase === "result");
    expect(room.failureReason).toBe("player-left");

    alice.emit(ClientEvents.GameRetry);
    await waitForEvent(alice, ServerEvents.RoomState);

    expect(agentRuntime.memory.currentAttempt()?.shared.retryBriefInput?.failureReason).toBe("player-left");
  });
});
