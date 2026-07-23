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

// discussion → placing 转换必须房间级单飞：任何并发触发（重复点击、
// 讨论计时器、重连恢复计时器）只允许一次策略收口和一次阶段推进，
// 后续触发不得取消首个收口（见 plans/2026-07-21-agent-discussion-and-placement-findings.md P0-1）。
describe("placement transition single-flight", () => {
  let httpServer: http.Server;
  let io: Server;
  let url: string;
  let clients: ClientSocket[];
  let room: ReturnType<typeof createGameRoom>;
  let agentRegistry: InMemoryAgentRegistry;
  let agentRuntime: AgentRuntime;
  let compileCalls: number;

  const levels = loadLevels();
  const progressStore: ProgressStore = {
    load: () => progress,
    save: async () => {},
    flushSync: () => {}
  };

  // 策略收口刻意放慢，制造“收口进行中再次触发”的窗口。
  const makeSlowCompileModelClient = () =>
    new MockModelClient(async (request) => {
      if (request.prompt.includes("compile_seat_strategy")) {
        compileCalls += 1;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 200);
          request.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        });
        return {
          content: JSON.stringify({
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
            privatePlan: ["把大牌留到区6"]
          })
        };
      }
      const input = JSON.parse(request.prompt) as { focusMessage?: { id?: string } };
      return {
        content: JSON.stringify({
          action: "speak",
          replyToMessageId: input.focusMessage?.id,
          message: "收到",
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
    compileCalls = 0;
    room = createGameRoom(structuredClone(progress), levels);
    agentRegistry = new InMemoryAgentRegistry();
    agentRuntime = new AgentRuntime({
      modelClient: makeSlowCompileModelClient(),
      discussion: { cooldownMs: 0, delay: async () => {} }
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

  it("host double begin-placement triggers exactly one compile and locks a non-empty strategy", async () => {
    const { alice } = await setupTwoHumansAndAgent();

    // 房主连续两次“提前开始出牌”：第二次不得启动新收口，也不得中止首个收口。
    alice.emit(ClientEvents.GameBeginPlacement);
    alice.emit(ClientEvents.GameBeginPlacement);

    await waitForCondition(() => room.phase === "placing");
    // 留出窗口暴露潜在的第二次收口调用。
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(compileCalls).toBe(1);
    const strategy = agentRuntime.memory.strategyFor("C");
    expect(strategy?.status).toBe("locked");
    expect(strategy?.rules.length ?? 0).toBeGreaterThan(0);
  });

  it("second trigger while finalize in flight does not abort the first compile", async () => {
    const { alice } = await setupTwoHumansAndAgent();

    alice.emit(ClientEvents.GameBeginPlacement);
    // 等首个收口真正开始后再触发第二次，命中“收口进行中”的并发窗口。
    await waitForCondition(() => compileCalls === 1);
    alice.emit(ClientEvents.GameBeginPlacement);

    await waitForCondition(() => room.phase === "placing");
    await new Promise((resolve) => setTimeout(resolve, 300));

    // 首个收口的结果必须提交：策略带规则，而不是被取消后锁定的空策略。
    const strategy = agentRuntime.memory.strategyFor("C");
    expect(strategy?.status).toBe("locked");
    expect(strategy?.rules.length ?? 0).toBeGreaterThan(0);
    expect(compileCalls).toBe(1);
  });
});
