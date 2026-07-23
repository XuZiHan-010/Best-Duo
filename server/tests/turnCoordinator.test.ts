import { describe, expect, it, vi } from "vitest";
import type { PlayerCount, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { BudgetedModelClient, ModelCallBudget } from "../src/agent/budget.js";
import { MockModelClient, type ModelRequest } from "../src/agent/modelClient.js";
import { AgentOrchestrator } from "../src/agent/orchestrator.js";
import { AgentTelemetry } from "../src/agent/telemetry.js";
import { TurnCoordinator } from "../src/agent/turnCoordinator.js";
import { AttemptMemoryStore } from "../src/agent/memory/attemptMemoryStore.js";
import { generateCandidates } from "../src/agent/candidates/index.js";
import { buildTurnView } from "../src/agent/views.js";
import { applyPlacement } from "../src/game/actions.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { createGameRoom } from "../src/game/room.js";
import { loadLevels } from "../src/levels/loadLevels.js";

const progress: ProgressState = {
  schemaVersion: 1,
  clearedLevels: [],
  settings: defaultSettings
};

const seatIds: SeatId[] = ["A", "B", "C", "D"];

const makePlacingRoom = (playerCount: PlayerCount = 2) => {
  const room = createGameRoom(progress, 4);
  for (const seatId of seatIds.slice(0, playerCount)) {
    const seat = room.seats.find((candidate) => candidate.id === seatId);
    if (!seat) throw new Error(`Missing seat ${seatId}`);
    seat.nick = seatId;
    seat.connected = true;
  }
  room.phase = "levelSelect";
  enterDiscussion(room, loadLevels()[0]);
  beginPlacement(room);
  room.turn = "A";
  return room;
};

const quietTelemetry = () => new AgentTelemetry(() => {});

const makeCoordinator = (handler: (request: ModelRequest) => Promise<{ content: string }>, telemetry = quietTelemetry()) => {
  const orchestrator = new AgentOrchestrator({ modelClient: new MockModelClient(handler), telemetry });
  return { coordinator: new TurnCoordinator(orchestrator, { telemetry, pacing: { enabled: false } }), telemetry };
};

describe("TurnCoordinator", () => {
  describe("M9.3 candidate pipeline", () => {
    it("injects top-K into the prompt and accepts an in-top-K model choice", async () => {
      const room = makePlacingRoom();
      const expected = generateCandidates(buildTurnView(room, "A"));
      const selected = expected.topK[1] ?? expected.topK[0]!;
      let promptTopK: Array<{ cardId: string; segment: number }> = [];
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async (request) => {
          const prompt = JSON.parse(request.prompt) as {
            candidateSelection: { evaluatorVersion: string; topK: Array<{ cardId: string; segment: number }> };
          };
          promptTopK = prompt.candidateSelection.topK;
          return { content: JSON.stringify({ ...selected, revealIntent: "yes" }) };
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: true,
        candidateConfidenceThreshold: Number.MAX_SAFE_INTEGER,
        pacing: { enabled: false }
      });

      await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual(selected);
      expect(promptTopK).toEqual(expected.topK);
    });

    it("rejects an out-of-top-K model action and uses candidate #1 with revealIntent=no", async () => {
      const room = makePlacingRoom();
      const expected = generateCandidates(buildTurnView(room, "A"));
      const topK = new Set(expected.topK.map((candidate) => `${candidate.cardId}:${candidate.segment}`));
      const outside = expected.ranked.find((candidate) => !topK.has(`${candidate.cardId}:${candidate.segment}`));
      if (!outside) throw new Error("expected an action outside top-K");
      let modelCalls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          modelCalls += 1;
          return { content: JSON.stringify({ cardId: outside.cardId, segment: outside.segment, revealIntent: "yes" }) };
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: true,
        candidateConfidenceThreshold: Number.MAX_SAFE_INTEGER,
        pacing: { enabled: false }
      });

      const placement = await coordinator.decidePlacement(room, "A");
      expect(placement).toEqual({ cardId: expected.ranked[0]!.cardId, segment: expected.ranked[0]!.segment });
      applyPlacement(room, "A", placement!);
      expect(coordinator.decideHint(room, "A")).toBe("no");
      expect(modelCalls).toBe(1);
    });

    it("runs the pure candidate-top1 baseline without calling the model", async () => {
      const room = makePlacingRoom();
      const expected = generateCandidates(buildTurnView(room, "A")).ranked[0]!;
      let modelCalls = 0;
      const telemetryLines: string[] = [];
      const telemetry = new AgentTelemetry((line) => telemetryLines.push(line));
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          modelCalls += 1;
          return { content: "{}" };
        }),
        telemetry
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: false,
        telemetry,
        pacing: { enabled: false }
      });

      const placement = await coordinator.decidePlacement(room, "A");
      expect(placement).toEqual({ cardId: expected.cardId, segment: expected.segment });
      expect(modelCalls).toBe(0);
      applyPlacement(room, "A", placement!);
      coordinator.completePlacement(room, "A", placement!.cardId, placement!.segment);
      const event = telemetryLines.map((line) => JSON.parse(line)).find((line) => line.kind === "turn_decision");
      expect(event).toMatchObject({
        source: "candidate",
        selectionSource: "candidate_top1",
        evaluatorVersion: "m9.3-v3-belief",
        hintDecisionSource: "default_no"
      });
      expect(event.candidateSetHash).toMatch(/^[a-f0-9]{16}$/);
    });

    it("skips the model when the configured top-1 confidence gate is met", async () => {
      const room = makePlacingRoom();
      const expected = generateCandidates(buildTurnView(room, "A")).ranked[0]!;
      let modelCalls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          modelCalls += 1;
          return { content: "{}" };
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: true,
        candidateConfidenceThreshold: 0,
        pacing: { enabled: false }
      });

      await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual({
        cardId: expected.cardId,
        segment: expected.segment
      });
      expect(modelCalls).toBe(0);
    });

    it("uses candidate #1 immediately when no model Provider is available", async () => {
      const room = makePlacingRoom();
      const expected = generateCandidates(buildTurnView(room, "A")).ranked[0]!;
      let modelCalls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          modelCalls += 1;
          return { content: "{}" };
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: true,
        modelAvailable: false,
        candidateConfidenceThreshold: Number.MAX_SAFE_INTEGER,
        pacing: { enabled: false }
      });

      await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual({
        cardId: expected.cardId,
        segment: expected.segment
      });
      expect(modelCalls).toBe(0);
    });

    it("keeps revealIntent=no on fallback even when a hard hint policy would reveal", async () => {
      const room = makePlacingRoom();
      for (const card of room.hands.A ?? []) card.visibleToOwner = true;
      const memory = new AttemptMemoryStore();
      memory.beginAttempt({
        campaignId: room.identity.campaignId,
        playSessionId: room.identity.playSessionId,
        levelRunId: room.identity.levelRunId!,
        levelId: room.currentChallenge!.id,
        attemptId: room.identity.attemptId!
      });
      memory.setStrategyDraft("A", {
        rules: [{
          id: "confirmed-reveal",
          type: "hint_policy",
          strength: "hard_commitment",
          targetSeatIds: ["A"],
          parameters: { mode: "always_known", minMarkers: 1 },
          sourceMessageIds: ["human-confirmation"]
        }],
        privatePlan: []
      });
      memory.lockStrategy("A");

      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => ({ content: "not-json" })),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        candidateEngineEnabled: true,
        modelTopKOnly: true,
        candidateConfidenceThreshold: Number.MAX_SAFE_INTEGER,
        memory,
        pacing: { enabled: false }
      });

      const placement = await coordinator.decidePlacement(room, "A");
      expect(placement).not.toBeNull();
      applyPlacement(room, "A", placement!);
      expect(coordinator.decideHint(room, "A")).toBe("no");
    });
  });

  it("uses one model call for placement and consumes the cached reveal intent in the hint window", async () => {
    const room = makePlacingRoom();
    const visibleCard = room.hands.A?.find((card) => card.visibleToOwner);
    if (!visibleCard) throw new Error("expected visible card");

    let modelCalls = 0;
    const { coordinator, telemetry } = makeCoordinator(async () => {
      modelCalls += 1;
      return { content: JSON.stringify({ cardId: visibleCard.id, segment: 2, revealIntent: "yes" }) };
    });

    const placement = await coordinator.decidePlacement(room, "A");
    expect(placement).toEqual({ cardId: visibleCard.id, segment: 2 });
    expect(telemetry.snapshot().decisionCount).toBe(0);

    applyPlacement(room, "A", placement!);
    coordinator.completePlacement(room, "A", placement!.cardId, placement!.segment);
    expect(telemetry.snapshot().decisionCount).toBe(1);
    expect(room.pendingHint?.cardId).toBe(visibleCard.id);

    expect(coordinator.decideHint(room, "A")).toBe("yes");
    expect(modelCalls).toBe(1);

    // 缓存一次性消费：再次询问按 no 处理。
    expect(coordinator.decideHint(room, "A")).toBe("no");
  });

  it("answers no when the pending hint is not the card from the cached decision", async () => {
    const room = makePlacingRoom();
    const [first, second] = (room.hands.A ?? []).filter((card) => card.visibleToOwner);
    if (!first || !second) throw new Error("expected two visible cards");

    const { coordinator } = makeCoordinator(async () => ({
      content: JSON.stringify({ cardId: first.id, segment: 0, revealIntent: "yes" })
    }));

    await coordinator.decidePlacement(room, "A");
    // 实际落下的是另一张牌（例如真人抢先或仲裁差异）。
    applyPlacement(room, "A", { cardId: second.id, segment: 0 });
    expect(coordinator.decideHint(room, "A")).toBe("no");
  });

  it("discards the decision when the room advanced while awaiting the model", async () => {
    const room = makePlacingRoom();
    let resolveModel: ((value: { content: string }) => void) | undefined;
    const { coordinator, telemetry } = makeCoordinator(
      () =>
        new Promise((resolve) => {
          resolveModel = resolve;
        })
    );

    const pending = coordinator.decidePlacement(room, "A");
    // await 期间房间被推进（其他座位落子/阶段变化）。
    room.turnVersion += 1;
    resolveModel?.({ content: JSON.stringify({ cardId: room.hands.A?.[0]?.id, segment: 1, revealIntent: "yes" }) });

    await expect(pending).resolves.toBeNull();
    expect(coordinator.decideHint(room, "A")).toBe("no");
    expect(telemetry.snapshot().cancelRate).toBe(1);
  });

  it("falls back within the model deadline instead of stalling the turn", async () => {
    const room = makePlacingRoom();
    const telemetry = quietTelemetry();
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(
        (request) =>
          new Promise((_, reject) => {
            request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })
      ),
      telemetry
    });
    // thinkSeconds=10：模型预算压到 max(10000-9950, 20) = 50ms。
    const fast = new TurnCoordinator(orchestrator, {
      deadlineSafetyMs: 9_950,
      minModelBudgetMs: 20,
      telemetry,
      pacing: { enabled: false }
    });

    const placement = await fast.decidePlacement(room, "A");
    expect(placement).not.toBeNull();
    expect(room.hands.A?.some((card) => card.id === placement?.cardId)).toBe(true);
    applyPlacement(room, "A", placement!);
    fast.completePlacement(room, "A", placement!.cardId, placement!.segment);

    const snapshot = telemetry.snapshot();
    expect(snapshot.deadlineMissRate).toBe(1);
    expect(snapshot.fallbackRate).toBe(1);
  });

  it("returns null when cancelled by the runtime even if versions did not change", async () => {
    const room = makePlacingRoom();
    const { coordinator, telemetry } = makeCoordinator(
      (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })
    );

    const pending = coordinator.decidePlacement(room, "A");
    coordinator.cancelAll();

    await expect(pending).resolves.toBeNull();
    expect(telemetry.snapshot().cancelRate).toBe(1);
    expect(telemetry.snapshot().deadlineMissRate).toBe(0);
  });

  it("cancels race losers without deleting the winner's reveal intent", async () => {
    const room = makePlacingRoom();
    room.turn = "race";
    const { coordinator, telemetry } = makeCoordinator(async (request) => {
      const view = JSON.parse(request.prompt) as { seatId: SeatId };
      const card = room.hands[view.seatId]?.[0];
      if (!card) throw new Error("missing race card");
      return { content: JSON.stringify({ cardId: card.id, segment: 1, revealIntent: "yes" }) };
    });

    const [winner, loser] = await Promise.all([
      coordinator.decidePlacement(room, "A"),
      coordinator.decidePlacement(room, "B")
    ]);
    expect(winner).not.toBeNull();
    expect(loser).not.toBeNull();

    applyPlacement(room, "A", winner!);
    coordinator.completePlacement(room, "A", winner!.cardId, winner!.segment);
    coordinator.cancelOtherSeats("A");

    expect(coordinator.decideHint(room, "A")).toBe("yes");
    expect(coordinator.decideHint(room, "B")).toBe("no");
    expect(telemetry.snapshot().decisionCount).toBe(2);
    expect(telemetry.snapshot().cancelRate).toBe(0.5);
  });

  it("degrades to fallback with budget_exceeded when the model budget is exhausted", async () => {
    const room = makePlacingRoom();
    const telemetry = quietTelemetry();
    const budget = new ModelCallBudget({ attemptMaxCalls: 0, attemptMaxTokens: 1, dailyMaxCalls: 1, dailyMaxTokens: 1 });
    budget.beginAttempt();
    const orchestrator = new AgentOrchestrator({
      modelClient: new BudgetedModelClient(
        new MockModelClient(async () => ({ content: "{}" })),
        budget
      ),
      telemetry
    });
    const coordinator = new TurnCoordinator(orchestrator, { telemetry, pacing: { enabled: false } });

    const placement = await coordinator.decidePlacement(room, "A");
    expect(placement).not.toBeNull();
    expect(room.hands.A?.some((card) => card.id === placement?.cardId)).toBe(true);

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));
    expect(decision.source).toBe("fallback");
    expect(decision.fallbackReason).toBe("budget_exceeded");
  });

  it("normally paces a fast model decision to the middle of the configured turn window", async () => {
    const room = makePlacingRoom();
    room.settings.thinkSeconds = 10;
    const card = room.hands.A?.[0];
    if (!card) throw new Error("expected card");

    let requestedDelayMs = -1;
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ cardId: card.id, segment: 0, revealIntent: "no" })
      })),
      telemetry: quietTelemetry()
    });
    const coordinator = new TurnCoordinator(orchestrator, {
      telemetry: quietTelemetry(),
      pacing: {
        random: () => 0,
        delay: async (ms) => {
          requestedDelayMs = ms;
        }
      }
    });

    await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual({ cardId: card.id, segment: 0 });
    expect(requestedDelayMs).toBeGreaterThanOrEqual(4_900);
    expect(requestedDelayMs).toBeLessThanOrEqual(5_000);
  });

  it("does not add pacing delay after the model has already thought past the target", async () => {
    const room = makePlacingRoom();
    room.settings.thinkSeconds = 10;
    const card = room.hands.A?.[0];
    if (!card) throw new Error("expected card");

    let now = 1_000;
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => now);
    const delay = vi.fn(async () => {});
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => {
        now += 6_000;
        return { content: JSON.stringify({ cardId: card.id, segment: 0, revealIntent: "no" }) };
      }),
      telemetry: quietTelemetry()
    });
    const coordinator = new TurnCoordinator(orchestrator, {
      telemetry: quietTelemetry(),
      pacing: { random: () => 0, delay }
    });

    try {
      await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual({ cardId: card.id, segment: 0 });
      expect(delay).not.toHaveBeenCalled();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it.each([
    [10, 7_500],
    [30, 10_000]
  ] as const)("%i 秒房间会在 %i ms 硬截止，即使 Provider 忽略取消也立即安全出牌", async (thinkSeconds, expectedDeadlineMs) => {
    vi.useFakeTimers();
    try {
      const room = makePlacingRoom();
      room.settings.thinkSeconds = thinkSeconds;
      let providerSignal: AbortSignal | undefined;
      const telemetry = quietTelemetry();
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(
          (request) => {
            providerSignal = request.signal;
            // 模拟不兑现 AbortSignal 的上游：本地硬截止仍必须返回安全决策。
            return new Promise(() => {});
          }
        ),
        telemetry
      });
      const coordinator = new TurnCoordinator(orchestrator, { telemetry, pacing: { enabled: false } });
      let settled = false;
      const pending = coordinator.decidePlacement(room, "A").then((placement) => {
        settled = true;
        return placement;
      });

      await vi.advanceTimersByTimeAsync(expectedDeadlineMs - 1);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);

      const placement = await pending;
      expect(placement).not.toBeNull();
      expect(providerSignal?.aborted).toBe(true);
      expect(providerSignal?.reason).toBe("deadline");
    } finally {
      vi.useRealTimers();
    }
  });

  it("长回合的可见思考节奏也封顶在 10 秒", async () => {
    const room = makePlacingRoom();
    room.settings.thinkSeconds = 30;
    const card = room.hands.A?.[0];
    if (!card) throw new Error("expected card");

    let requestedDelayMs = -1;
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ cardId: card.id, segment: 0, revealIntent: "no" })
      })),
      telemetry: quietTelemetry()
    });
    const coordinator = new TurnCoordinator(orchestrator, {
      telemetry: quietTelemetry(),
      pacing: {
        random: () => 1,
        delay: async (ms) => {
          requestedDelayMs = ms;
        }
      }
    });

    await expect(coordinator.decidePlacement(room, "A")).resolves.toEqual({ cardId: card.id, segment: 0 });
    expect(requestedDelayMs).toBeGreaterThanOrEqual(9_900);
    expect(requestedDelayMs).toBeLessThanOrEqual(10_000);
  });

  describe("连续失败熔断", () => {
    it("连续降级达上限后不再调用模型，直接走规则安全策略", async () => {
      const room = makePlacingRoom();
      let modelCalls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          modelCalls += 1;
          return { content: "not-json" }; // 每次都 illegal_output → 降级，且不触发 L1 重试
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        telemetry: quietTelemetry(),
        pacing: { enabled: false },
        maxConsecutiveFallbacks: 3
      });

      // 前 3 手每手调一次模型（都失败降级），第 4 手起熔断打开，跳过模型调用。
      for (let i = 0; i < 5; i += 1) {
        const placement = await coordinator.decidePlacement(room, "A");
        expect(placement).not.toBeNull();
        expect(room.hands.A?.some((card) => card.id === placement?.cardId)).toBe(true);
      }

      expect(modelCalls).toBe(3);
      expect(coordinator.consecutiveFallbacksOf("A")).toBeGreaterThanOrEqual(3);
    });

    it("模型成功一次即重置熔断计数", async () => {
      const room = makePlacingRoom();
      const card = room.hands.A?.find((c) => c.visibleToOwner);
      if (!card) throw new Error("expected visible card");
      let call = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          call += 1;
          if (call === 1) return { content: "not-json" }; // 先失败一次
          return { content: JSON.stringify({ cardId: card.id, segment: 1, revealIntent: "no" }) };
        }),
        telemetry: quietTelemetry()
      });
      const coordinator = new TurnCoordinator(orchestrator, {
        telemetry: quietTelemetry(),
        pacing: { enabled: false },
        maxConsecutiveFallbacks: 3
      });

      await coordinator.decidePlacement(room, "A");
      expect(coordinator.consecutiveFallbacksOf("A")).toBe(1);
      await coordinator.decidePlacement(room, "A");
      expect(coordinator.consecutiveFallbacksOf("A")).toBe(0);
    });
  });
});
