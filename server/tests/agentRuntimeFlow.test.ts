import http from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEvents, ServerEvents, type ProgressState, type SeatId } from "@take-time/shared";
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

describe("agent runtime socket flow", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let agentRegistry: InMemoryAgentRegistry;
  let agentRuntime: AgentRuntime;

  const levels = loadLevels();
  const progressStore: ProgressStore = {
    load: () => progress,
    save: async () => {},
    flushSync: () => {}
  };

  // 讨论发言与策略编译共用一个 mock：按 prompt 内容区分任务。
  const makeMockModelClient = () =>
    new MockModelClient(async (request) => {
      if (request.prompt.includes("compile_seat_strategy")) {
        const input = JSON.parse(request.prompt) as { view?: { chat?: Array<{ id: string; kind: string }> } };
        const publicSourceId = input.view?.chat?.find((message) => message.kind === "human")?.id;
        return {
          content: JSON.stringify({
            rules: [
              {
                type: "segment_assignment",
                strength: "strong_preference",
                targetSeatIds: ["C"],
                targetSegments: [5],
                parameters: {},
                sourceMessageIds: publicSourceId ? [publicSourceId] : []
              }
            ],
            privatePlan: ["把大牌留到区6"]
          })
        };
      }
      const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
      return {
        content: JSON.stringify({
          action: "speak",
          replyToMessageId: input.focusMessage?.id,
          message: "你提到区6留大牌，我赞同",
          entities: []
        })
      };
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

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels);
    agentRegistry = new InMemoryAgentRegistry();
    agentRuntime = new AgentRuntime({
      modelClient: makeMockModelClient(),
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

  it("lets humans see agent speech in discussion and locks the agent strategy at discussion end", async () => {
    const { alice } = await setupTwoHumansAndAgent();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(room.chat.some((message) => message.kind === "agent")).toBe(false);

    alice.emit(ClientEvents.ChatSend, { text: "我建议区6留给大牌，你怎么看？" });
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => room.chat.some((message) => message.kind === "agent"));
    const agentMessage = room.chat.find((message) => message.kind === "agent");
    expect(agentMessage?.attemptId).toBe(room.identity.attemptId);
    expect(agentMessage?.text).toBe("你提到区6留大牌，我赞同");

    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => agentRuntime.memory.strategyFor("C") !== null);

    const strategy = agentRuntime.memory.strategyFor("C");
    expect(strategy?.status).toBe("locked");
    expect(strategy?.rules[0]?.strength).toBe("strong_preference");
    expect(room.agentState.seats[0]).toMatchObject({
      seatId: "C",
      strategyVersion: 1,
      strategyRules: [{ type: "segment_assignment", strength: "strong_preference" }]
    });
    const publicAgentJson = JSON.stringify(room.agentState);
    expect(publicAgentJson).not.toContain("privatePlan");
    expect(publicAgentJson).not.toContain("belief");
  });

  it("feeds a retry brief into a same-level retry after a failed attempt", async () => {
    const { alice, bob } = await setupTwoHumansAndAgent();
    const firstAttemptId = room.identity.attemptId;

    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => room.phase === "placing");

    const socketsBySeat: Partial<Record<SeatId, ClientSocket>> = { A: alice, B: bob };
    // 真人全部堆区0制造失败；Agent C 由脚本代理自动出牌。
    while (room.phase === "placing") {
      if (room.pendingHint) {
        const seatId = room.pendingHint.seatId;
        const socket = socketsBySeat[seatId];
        if (socket) {
          socket.emit(ClientEvents.HintDecide, { decision: "no" });
          await waitForEvent(socket, ServerEvents.RoomState);
        } else {
          await waitForCondition(() => !room.pendingHint || room.pendingHint.seatId !== seatId);
        }
        continue;
      }

      const turn = room.turn;
      const seatId = turn === "race" ? "A" : turn;
      if (!seatId) break;
      const socket = socketsBySeat[seatId];
      if (!socket) {
        await waitForCondition(() => room.turn !== turn || room.phase !== "placing");
        continue;
      }
      const card = room.hands[seatId]?.[0];
      if (!card) break;
      socket.emit(ClientEvents.CardPlace, { cardId: card.id, segment: 0 });
      await waitForEvent(socket, ServerEvents.RoomState);
    }

    await waitForCondition(() => room.phase === "reveal");
    expect(room.revealResult?.pass).toBe(false);

    alice.emit(ClientEvents.GameContinueToResult);
    await waitForEvent(alice, ServerEvents.RoomState);
    expect(room.phase).toBe("result");

    alice.emit(ClientEvents.GameRetry);
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => room.identity.attemptId !== firstAttemptId);

    const attempt = agentRuntime.memory.currentAttempt();
    expect(attempt?.shared.retryBriefInput?.sourceAttemptId).toBe(firstAttemptId);
    expect(attempt?.shared.retryBriefInput?.failedSegments.length).toBeGreaterThan(0);
  });
});
