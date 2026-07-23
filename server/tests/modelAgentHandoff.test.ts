import { describe, expect, it } from "vitest";
import type { ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { MockModelClient, UnconfiguredModelClient } from "../src/agent/modelClient.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import { AgentTelemetry } from "../src/agent/telemetry.js";
import type { AgentRegistry } from "../src/agent/agentDriver.js";
import { continueTurnOrHandoff } from "../src/game/handoff.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom, totalPlacedCards } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const quietTelemetry = () => new AgentTelemetry(() => {});

// 2 真人（A/B）+ 1 模型 Agent（C）的出牌 handoff 集成：
// 一次模型调用同时决定 placement 与 hint（M9.2 验收）。
const makeRoomWithAgentSeat = () => {
  const room = createGameRoom(progress, 4);
  const seats: Array<{ id: SeatId; kind: "human" | "agent" }> = [
    { id: "A", kind: "human" },
    { id: "B", kind: "human" },
    { id: "C", kind: "agent" }
  ];
  for (const { id, kind } of seats) {
    const seat = room.seats.find((candidate) => candidate.id === id);
    if (!seat) throw new Error(`Missing seat ${id}`);
    seat.nick = kind === "agent" ? "AI-1" : id;
    seat.kind = kind;
    seat.connected = true;
    if (kind === "agent") seat.agentId = "agent-c";
  }
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  beginPlacement(room);
  return room;
};

const makeTwoPlayerRoomWithAgent = () => {
  const room = createGameRoom(progress, 4);
  for (const { id, kind } of [
    { id: "A" as const, kind: "human" as const },
    { id: "B" as const, kind: "agent" as const }
  ]) {
    const seat = room.seats.find((candidate) => candidate.id === id)!;
    seat.nick = kind === "agent" ? "AI-1" : id;
    seat.kind = kind;
    seat.connected = true;
    if (kind === "agent") seat.agentId = "agent-b";
  }
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  beginPlacement(room);
  return room;
};

const handoffOptions = (registry: AgentRegistry) => ({
  afterRevealIfNeeded: async () => {},
  startTurnTimer: () => {},
  agentRegistry: registry
});

describe("model agent handoff", () => {
  it("can legally choose and place a two-player blind card", async () => {
    const room = makeTwoPlayerRoomWithAgent();
    const blindCard = room.hands.B?.find((card) => !card.visibleToOwner);
    if (!blindCard) throw new Error("expected blind card");
    const runtime = new AgentRuntime({
      telemetry: quietTelemetry(),
      turn: { candidateEngineEnabled: false },
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          cardId: blindCard.id,
          segment: 2,
          revealIntent: "no",
          appliedStrategyRuleIds: [],
          relaxedStrategyRuleIds: []
        })
      }))
    });
    const registry: AgentRegistry = { get: () => runtime.createSeatAgent(room, "B") };

    room.turn = "B";
    await continueTurnOrHandoff(room, handoffOptions(registry));

    expect(room.placements[2].some((card) => card.id === blindCard.id)).toBe(true);
  });

  it("places and resolves the hint window from a single model call", async () => {
    const room = makeRoomWithAgentSeat();
    const agentCard = room.hands.C?.find((card) => card.visibleToOwner);
    if (!agentCard) throw new Error("expected agent card");

    let modelCalls = 0;
    const runtime = new AgentRuntime({
      telemetry: quietTelemetry(),
      turn: { candidateEngineEnabled: false },
      modelClient: new MockModelClient(async (request) => {
        if (request.task !== "turn") throw new Error("unexpected task");
        modelCalls += 1;
        return { content: JSON.stringify({ cardId: agentCard.id, segment: 4, revealIntent: "yes" }) };
      })
    });
    const agent = runtime.createSeatAgent(room, "C");
    const registry: AgentRegistry = { get: (agentId) => (agentId === "agent-c" ? agent : undefined) };

    room.turn = "C";
    await continueTurnOrHandoff(room, handoffOptions(registry));

    expect(modelCalls).toBe(1);
    const placed = room.placements[4]?.find((card) => card.id === agentCard.id);
    expect(placed).toBeDefined();
    // revealIntent=yes：hint 窗口消费缓存意图，翻开该牌并消耗一枚标记。
    expect(placed?.revealed).toBe(true);
    expect(room.hintMarkers.used).toBe(1);
    expect(room.pendingHint).toBeNull();
    expect(totalPlacedCards(room)).toBe(1);
    // 回合已交还给下一个座位。
    expect(room.turn).not.toBe("C");
  });

  it("carries applied strategy ids through the legal placement into private memory", async () => {
    const room = makeRoomWithAgentSeat();
    const card = room.hands.C?.[0];
    if (!card) throw new Error("expected card");
    const runtime = new AgentRuntime({
      telemetry: quietTelemetry(),
      turn: { candidateEngineEnabled: false },
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          cardId: card.id,
          segment: 1,
          revealIntent: "no",
          appliedStrategyRuleIds: ["rule-c"],
          relaxedStrategyRuleIds: []
        })
      }))
    });
    runtime.memory.beginAttempt({
      campaignId: room.identity.campaignId,
      playSessionId: room.identity.playSessionId,
      levelRunId: room.identity.levelRunId!,
      levelId: room.currentChallenge!.id,
      attemptId: room.identity.attemptId!
    });
    runtime.memory.setStrategyDraft("C", {
      rules: [
        {
          id: "rule-c",
          type: "segment_assignment",
          strength: "suggestion",
          targetSeatIds: ["C"],
          targetSegments: [1],
          parameters: {},
          sourceMessageIds: []
        }
      ],
      privatePlan: []
    });
    runtime.memory.lockStrategy("C");
    const registry: AgentRegistry = { get: () => runtime.createSeatAgent(room, "C") };

    room.turn = "C";
    await continueTurnOrHandoff(room, {
      ...handoffOptions(registry),
      onPlacement: (seatId, segment, placed) => runtime.recordPlacement(room, seatId, segment, placed)
    });

    expect(runtime.memory.viewForSeat("C").ownPrivateMemory.ownActions[0]?.appliedStrategyRuleIds).toEqual([
      "rule-c"
    ]);
    expect(runtime.memory.viewForSeat("C").ownPrivateMemory.ownActions[0]?.payload).toMatchObject({
      cardId: card.id,
      segment: 1,
      knownValue: card.value,
      knownColor: card.color
    });
  });

  it("keeps the reveal intent 'no' without spending a marker", async () => {
    const room = makeRoomWithAgentSeat();
    const agentCard = room.hands.C?.find((card) => card.visibleToOwner);
    if (!agentCard) throw new Error("expected agent card");

    const runtime = new AgentRuntime({
      telemetry: quietTelemetry(),
      turn: { candidateEngineEnabled: false },
      modelClient: new MockModelClient(async () => ({
        // 区 2 对任意随机发牌都不可证必输（level-01 的区 1 只收白牌，
        // 硬编码区 0 会在抽到黑牌时被安全护栏正当替换）。
        content: JSON.stringify({ cardId: agentCard.id, segment: 2, revealIntent: "no" })
      }))
    });
    const registry: AgentRegistry = { get: () => runtime.createSeatAgent(room, "C") };

    room.turn = "C";
    await continueTurnOrHandoff(room, handoffOptions(registry));

    const placed = room.placements[2]?.find((card) => card.id === agentCard.id);
    expect(placed?.revealed).toBe(false);
    expect(room.hintMarkers.used).toBe(0);
  });

  it("still places a legal card when the provider is not configured", async () => {
    const room = makeRoomWithAgentSeat();
    // 显式注入未配置 client，避免本地 .env 的真实 key 让该测试意外访问 Provider。
    const runtime = new AgentRuntime({
      telemetry: quietTelemetry(),
      modelClient: new UnconfiguredModelClient()
    });
    const registry: AgentRegistry = { get: () => runtime.createSeatAgent(room, "C") };

    room.turn = "C";
    await continueTurnOrHandoff(room, handoffOptions(registry));

    expect(totalPlacedCards(room)).toBe(1);
    expect(room.hintMarkers.used).toBe(0);
  });
});
