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
import { CURRENT_DISCUSSION_MESSAGE_SOURCE } from "../src/agent/orchestrator.js";
import { appendChatMessage } from "../src/game/chat.js";
import { enterDiscussion } from "../src/game/phases.js";
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

describe("game event observations over sockets", () => {
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

  const sharedObservations = () => agentRuntime.memory.currentAttempt()?.shared.observations ?? [];

  beforeEach(async () => {
    room = createGameRoom(structuredClone(progress), levels);
    agentRegistry = new InMemoryAgentRegistry();
    agentRuntime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
        }
        const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
        return {
          content: JSON.stringify({
            action: "speak",
            replyToMessageId: input.focusMessage?.id,
            message: "区6留大牌可行",
            entities: []
          })
        };
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

  it("records phase, placement, hint and result events as versioned public observations", async () => {
    const { alice, bob } = await setupTwoHumansAndAgent();

    // 进入讨论即有 phase_changed observation。
    await waitForCondition(() =>
      sharedObservations().some(
        (observation) =>
          observation.type === "phase_changed" &&
          (observation.payload as { phase?: string }).phase === "discussion"
      )
    );

    alice.emit(ClientEvents.GameBeginPlacement);
    await waitForEvent(alice, ServerEvents.RoomState);
    await waitForCondition(() => room.phase === "placing");
    await waitForCondition(() =>
      sharedObservations().some(
        (observation) =>
          observation.type === "phase_changed" &&
          (observation.payload as { phase?: string }).phase === "placing"
      )
    );

    // 真人抢先手落子：公开 placement observation，暗牌不含数值。
    const aliceCard = room.hands.A?.[0];
    expect(aliceCard).toBeTruthy();
    alice.emit(ClientEvents.CardPlace, { cardId: aliceCard!.id, segment: 0 });
    await waitForEvent(alice, ServerEvents.RoomState);

    await waitForCondition(() => sharedObservations().some((observation) => observation.type === "placement"));
    const alicePlacement = sharedObservations().find((observation) => observation.type === "placement");
    expect(alicePlacement?.visibility).toBe("public");
    expect(alicePlacement?.sourceSeatId).toBe("A");
    const placementPayload = alicePlacement?.payload as { segment?: number; color?: string; value?: number };
    expect(placementPayload.segment).toBe(0);
    expect(placementPayload.color).toBeDefined();
    expect(placementPayload.value).toBeUndefined();

    // 提示窗口选择翻开：hint observation 带公开后的数值。
    await waitForCondition(() => room.pendingHint?.seatId === "A");
    alice.emit(ClientEvents.HintDecide, { decision: "yes" });
    await waitForEvent(alice, ServerEvents.RoomState);

    await waitForCondition(() => sharedObservations().some((observation) => observation.type === "hint"));
    const hintObservation = sharedObservations().find((observation) => observation.type === "hint");
    expect(hintObservation?.sourceSeatId).toBe("A");
    const hintPayload = hintObservation?.payload as { decision?: string; value?: number };
    expect(hintPayload.decision).toBe("yes");
    expect(hintPayload.value).toBe(aliceCard!.value);

    // 轮到 Bob 落子，然后脚本 Agent（C）自动落子：Agent 路径同样写 observation。
    await waitForCondition(() => room.turn === "B");
    const bobCard = room.hands.B?.[0];
    bob.emit(ClientEvents.CardPlace, { cardId: bobCard!.id, segment: 0 });
    await waitForEvent(bob, ServerEvents.RoomState);
    await waitForCondition(() => room.pendingHint?.seatId === "B");
    bob.emit(ClientEvents.HintDecide, { decision: "no" });
    await waitForEvent(bob, ServerEvents.RoomState);

    await waitForCondition(() =>
      sharedObservations().some(
        (observation) => observation.type === "placement" && observation.sourceSeatId === "C"
      )
    );

    // 玩家离开：result observation 带失败原因。
    bob.emit(ClientEvents.PlayerLeave);
    await waitForCondition(() => room.phase === "result");
    await waitForCondition(() => sharedObservations().some((observation) => observation.type === "result"));
    const resultObservation = sharedObservations().find((observation) => observation.type === "result");
    const resultPayload = resultObservation?.payload as { pass?: boolean; failureReason?: string };
    expect(resultPayload.pass).toBe(false);
    expect(resultPayload.failureReason).toBe("player-left");
    expect(
      sharedObservations().some(
        (observation) =>
          observation.type === "phase_changed" &&
          (observation.payload as { phase?: string }).phase === "result"
      )
    ).toBe(true);
  });
});

describe("discussion entity ingestion", () => {
  it("maps the reserved current-message source to the Agent message generated by the server", async () => {
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
        }
        const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
        return {
          content: JSON.stringify({
            action: "speak",
            replyToMessageId: input.focusMessage?.id,
            message: "我负责区6",
            entities: [
              {
                entityType: "commitment",
                entityId: "seat:C",
                attribute: "承诺",
                value: "负责区6",
                certainty: "explicit",
                sourceMessageIds: [CURRENT_DISCUSSION_MESSAGE_SOURCE]
              }
            ]
          })
        };
      }),
      discussion: { maxMessagesPerAgent: 1, cooldownMs: 0, delay: async () => {} }
    });
    const room = createGameRoom(structuredClone(progress), levels);
    const seatC = room.seats.find((seat) => seat.id === "C")!;
    Object.assign(seatC, { kind: "agent", nick: "AI-1", agentId: "agent-c", connected: true });
    room.phase = "levelSelect";
    enterDiscussion(room, levels[0]);

    runtime.onDiscussionStarted(room);
    const humanMessage = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "谁负责区6？"
    });
    runtime.recordPublicChat(room, humanMessage);
    await waitForCondition(() => runtime.memory.sharedFacts().length === 1);
    runtime.cancelDiscussion();

    const fact = runtime.memory.sharedFacts()[0];
    const source = runtime.memory
      .currentAttempt()
      ?.shared.observations.find((observation) => observation.id === fact.sourceObservationIds[0]);
    expect(source?.sourceSeatId).toBe("C");
    expect((source?.payload as { text?: string }).text).toBe("我负责区6");
  });

  it("ingests entity candidates returned alongside agent speech, mapped from message ids", async () => {
    let humanMessageId = "";
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
        }
        const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
        return {
          content: JSON.stringify({
            action: "speak",
            replyToMessageId: input.focusMessage?.id,
            message: "收到，A 负责区6",
            entities: [
              {
                entityType: "commitment",
                entityId: "seat:A",
                attribute: "承诺",
                value: "区6 放三张",
                certainty: "explicit",
                sourceMessageIds: [humanMessageId]
              }
            ]
          })
        };
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

    // 先有真人公开发言，再启动讨论调度：Agent 发言时引用该消息提出实体候选。
    const humanMessage = appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "区6我放三张" });
    humanMessageId = humanMessage.id;
    runtime.onDiscussionStarted(room);
    runtime.recordPublicChat(room, humanMessage);

    await waitForCondition(() => runtime.memory.sharedFacts().length > 0);
    runtime.cancelDiscussion();

    const fact = runtime.memory.sharedFacts()[0];
    expect(fact.entityType).toBe("commitment");
    expect(fact.entityId).toBe("seat:A");
    expect(fact.certainty).toBe("explicit");
    expect(fact.sourceObservationIds).toHaveLength(1);

    // 来源必须映射为公开 chat observation 的 id。
    const observation = runtime.memory
      .currentAttempt()
      ?.shared.observations.find((candidate) => candidate.id === fact.sourceObservationIds[0]);
    expect(observation?.type).toBe("chat");
    expect((observation?.payload as { messageId?: string }).messageId).toBe(humanMessage.id);
  });

  it("rejects entity candidates citing unknown message ids", async () => {
    const runtime = new AgentRuntime({
      modelClient: new MockModelClient(async (request) => {
        if (request.prompt.includes("compile_seat_strategy")) {
          return { content: JSON.stringify({ rules: [], privatePlan: [] }) };
        }
        const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
        return {
          content: JSON.stringify({
            action: "speak",
            replyToMessageId: input.focusMessage?.id,
            message: "我猜 B 有大牌",
            entities: [
              {
                entityType: "seat",
                entityId: "seat:B",
                attribute: "手牌",
                value: "有大牌",
                certainty: "explicit",
                sourceMessageIds: ["message-that-does-not-exist"]
              }
            ]
          })
        };
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
    const humanMessage = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "你怎么看 B 的计划？"
    });
    runtime.recordPublicChat(room, humanMessage);
    await waitForCondition(() => room.chat.some((message) => message.kind === "agent"));
    runtime.cancelDiscussion();

    expect(runtime.memory.sharedFacts()).toHaveLength(0);
  });
});
