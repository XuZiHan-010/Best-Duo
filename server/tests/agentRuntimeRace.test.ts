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
import { MockModelClient, type ModelRequest, type ModelResponse } from "../src/agent/modelClient.js";
import { createGameRoom } from "../src/game/room.js";
import { clearAllTimers } from "../src/game/timers.js";
import { enterDiscussion } from "../src/game/phases.js";
import { loadLevels } from "../src/levels/loadLevels.js";
import type { ProgressStore } from "../src/persistence/progressStore.js";
import { registerHandlers } from "../src/socket/registerHandlers.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const levels = loadLevels();

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const staleStrategyOutput = JSON.stringify({
  rules: [
    {
      type: "segment_assignment",
      strength: "strong_preference",
      targetSeatIds: ["C"],
      targetSegments: [5],
      parameters: {},
      sourceMessageIds: []
    }
  ],
  privatePlan: ["旧 attempt 的私人计划"]
});

const discussionOutput = JSON.stringify({ message: "我建议区6放大牌" });

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

describe("agent runtime stale-response protection", () => {
  it("times out a hanging strategy compilation and locks an honestly-labeled unavailable strategy", async () => {
    const runtime = new AgentRuntime({
      strategyDeadlineMs: 20,
      modelClient: new MockModelClient(
        (request) =>
          new Promise((_resolve, reject) => {
            request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      ),
      discussion: { maxMessagesPerAgent: 1, cooldownMs: 0, delay: async () => {} }
    });
    const room = createGameRoom(structuredClone(progress), levels);
    const seatC = room.seats.find((seat) => seat.id === "C")!;
    Object.assign(seatC, { kind: "agent", nick: "AI-1", agentId: "agent-c", connected: true });
    room.phase = "levelSelect";
    enterDiscussion(room, levels[0]);
    runtime.onDiscussionStarted(room);

    await runtime.finalizeDiscussion(room);

    expect(runtime.memory.strategyFor("C")).toMatchObject({
      status: "locked",
      rules: [],
      source: "unavailable",
      compileOutcome: "timeout"
    });
  });

  it("compiles strategies for multiple agent seats in parallel", async () => {
    const compileGate = deferred();
    let compileStarts = 0;
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          compileStarts += 1;
          await compileGate.promise;
          return { content: JSON.stringify({ rules: [], privatePlan: ["计划"] }) };
        }
        return { content: discussionOutput };
      }),
      discussion: { maxMessagesPerAgent: 0, cooldownMs: 0, delay: async () => {} }
    });
    const room = createGameRoom(structuredClone(progress), levels);
    for (const seatId of ["C", "D"] as const) {
      const seat = room.seats.find((candidate) => candidate.id === seatId)!;
      Object.assign(seat, { kind: "agent", nick: `AI-${seatId}`, agentId: `agent-${seatId}`, connected: true });
    }
    room.phase = "levelSelect";
    enterDiscussion(room, levels[0]);
    runtime.onDiscussionStarted(room);

    const finalizePromise = runtime.finalizeDiscussion(room);
    // 串行实现下第二个座位的请求要等第一个 resolve 才发起，这里会超时。
    await waitForCondition(() => compileStarts === 2);
    compileGate.resolve();
    await finalizePromise;

    expect(runtime.memory.strategyFor("C")).toMatchObject({ status: "locked" });
    expect(runtime.memory.strategyFor("D")).toMatchObject({ status: "locked" });
  });

  it("discards a strategy response that resolves after the room moved to a new attempt", async () => {
    const compileGate = deferred();
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          await compileGate.promise;
          return { content: staleStrategyOutput };
        }
        return { content: discussionOutput };
      }),
      discussion: { maxMessagesPerAgent: 1, cooldownMs: 0, delay: async () => {} }
    });

    const room = createGameRoom(structuredClone(progress), levels);
    const seatC = room.seats.find((seat) => seat.id === "C")!;
    seatC.kind = "agent";
    seatC.nick = "AI-1";
    seatC.agentId = "agent-c";
    seatC.connected = true;
    room.phase = "levelSelect";

    enterDiscussion(room, levels[0]);
    runtime.onDiscussionStarted(room);

    // 讨论收口挂起在模型调用上。
    const finalizePromise = runtime.finalizeDiscussion(room);

    // 挂起期间房主返回选关并重选新关：进入新 attempt。
    room.phase = "levelSelect";
    enterDiscussion(room, levels[1]);
    runtime.onDiscussionStarted(room);
    const newAttemptId = room.identity.attemptId;

    compileGate.resolve();
    await finalizePromise;
    runtime.cancelDiscussion();

    // 旧 attempt 的模型响应不得写入新 attempt 的策略。
    expect(runtime.memory.currentAttempt()?.identity.attemptId).toBe(newAttemptId);
    expect(runtime.memory.strategyFor("C")).toBeNull();
  });

  it("discards a strategy response after leaving discussion without changing attemptId", async () => {
    const compileGate = deferred();
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          await compileGate.promise;
          return { content: staleStrategyOutput };
        }
        return { content: discussionOutput };
      }),
      discussion: { maxMessagesPerAgent: 1, cooldownMs: 0, delay: async () => {} }
    });
    const room = createGameRoom(structuredClone(progress), levels);
    const seatC = room.seats.find((seat) => seat.id === "C")!;
    Object.assign(seatC, { kind: "agent", nick: "AI-1", agentId: "agent-c", connected: true });
    room.phase = "levelSelect";
    enterDiscussion(room, levels[0]);
    runtime.onDiscussionStarted(room);

    const attemptId = room.identity.attemptId;
    const finalizePromise = runtime.finalizeDiscussion(room);
    room.phase = "levelSelect";
    room.phaseVersion += 1;
    compileGate.resolve();
    await finalizePromise;

    expect(room.identity.attemptId).toBe(attemptId);
    expect(runtime.memory.strategyFor("C")).toBeNull();
  });
});

describe("stale begin-placement request over sockets", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let agentRegistry: InMemoryAgentRegistry;
  let agentRuntime: AgentRuntime;
  let modelHandler: (request: ModelRequest) => Promise<ModelResponse>;

  const progressStore: ProgressStore = {
    load: () => progress,
    save: async () => {},
    flushSync: () => {}
  };

  beforeEach(async () => {
    modelHandler = async () => ({ content: discussionOutput });
    room = createGameRoom(structuredClone(progress), levels);
    agentRegistry = new InMemoryAgentRegistry();
    agentRuntime = new AgentRuntime({
      modelClient: new MockModelClient((request) => modelHandler(request)),
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

  it("does not let a stale begin-placement request advance a newer discussion", async () => {
    const compileGate = deferred();
    let compileRequested = false;
    modelHandler = async (request) => {
      if (request.prompt.includes("compile_seat_strategy")) {
        compileRequested = true;
        await compileGate.promise;
        return { content: staleStrategyOutput };
      }
      return { content: discussionOutput };
    };

    const { alice } = await setupTwoHumansAndAgent();
    const firstAttemptId = room.identity.attemptId;

    // 房主提前开始出牌：讨论收口挂起在模型调用上。
    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForCondition(() => compileRequested);

    // 挂起期间房主返回选关并重选另一关：新讨论、新 attempt。
    alice.emit(ClientEvents.HostBackToLevelSelect);
    await waitForEvent(alice, ServerEvents.RoomState);
    alice.emit(ClientEvents.HostSelectLevel, { levelIndex: 2 });
    await waitForEvent(alice, ServerEvents.RoomState);
    const newAttemptId = room.identity.attemptId;
    expect(newAttemptId).not.toBe(firstAttemptId);
    expect(room.phase).toBe("discussion");

    // 旧请求恢复执行：不得推进新讨论、不得污染新 attempt 的策略。
    compileGate.resolve();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(room.phase).toBe("discussion");
    expect(room.identity.attemptId).toBe(newAttemptId);
    expect(agentRuntime.memory.strategyFor("C")).toBeNull();
  });
});
