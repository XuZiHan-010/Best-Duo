import { describe, expect, it } from "vitest";
import type { PlayerCount, ProgressState, SeatId } from "@take-time/shared";
import { defaultSettings } from "../src/config.js";
import { AgentOrchestrator, CURRENT_DISCUSSION_MESSAGE_SOURCE } from "../src/agent/orchestrator.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import { ProviderRequestError } from "../src/agent/providers.js";
import { BudgetExceededError } from "../src/agent/budget.js";
import { AgentTelemetry } from "../src/agent/telemetry.js";
import { buildDiscussionView, buildTurnView } from "../src/agent/views.js";
import { beginPlacement, enterDiscussion } from "../src/game/phases.js";
import { appendChatMessage } from "../src/game/chat.js";
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

describe("AgentOrchestrator", () => {
  it("uses the injected model client's valid turn decision", async () => {
    const room = makePlacingRoom();
    const visibleCard = room.hands.A?.find((card) => card.visibleToOwner);
    if (!visibleCard) throw new Error("expected visible card");

    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ cardId: visibleCard.id, segment: 3, revealIntent: "no" })
      }))
    });

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));

    expect(decision.cardId).toBe(visibleCard.id);
    expect(decision.segment).toBe(3);
    expect(decision.source).toBe("model");
  });

  it("falls back to a legal heuristic move when the model output is not valid JSON", async () => {
    const room = makePlacingRoom();
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({ content: "我觉得放区6比较好" }))
    });

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));

    expect(room.hands.A?.some((card) => card.id === decision.cardId)).toBe(true);
    expect(decision.segment).toBeGreaterThanOrEqual(0);
    expect(decision.segment).toBeLessThanOrEqual(5);
    expect(decision.source).toBe("fallback");
    expect(decision.fallbackReason).toBe("illegal_output");
  });

  it("falls back when the model picks a card that is not in the seat's hand", async () => {
    const room = makePlacingRoom();
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ cardId: "not-my-card", segment: 0, revealIntent: "no" })
      }))
    });

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));

    expect(room.hands.A?.some((card) => card.id === decision.cardId)).toBe(true);
    expect(decision.source).toBe("fallback");
  });

  it.each([
    ["empty response", ""],
    ["out-of-range segment", JSON.stringify({ cardId: "placeholder", segment: 6, revealIntent: "no" })]
  ])("falls back for %s", async (_name, content) => {
    const room = makePlacingRoom();
    const card = room.hands.A?.[0];
    if (!card) throw new Error("expected card");
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({ content: content.replace("placeholder", card.id) }))
    });

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));

    expect(decision.source).toBe("fallback");
    expect(decision.fallbackReason).toBe("illegal_output");
  });

  it("accepts only strategy rule ids present in the current seat context", async () => {
    const room = makePlacingRoom();
    const card = room.hands.A?.[0];
    if (!card) throw new Error("expected card");
    const view = buildTurnView(room, "A");
    view.memory = {
      lockedSeatStrategy: {
        version: 1,
        privatePlan: [],
        rules: [
          {
            id: "known-rule",
            type: "segment_assignment",
            strength: "suggestion",
            targetSeatIds: ["A"],
            targetSegments: [1],
            parameters: {},
            sourceMessageIds: []
          }
        ]
      },
      ownActions: [],
      currentBeliefs: [],
      pendingCommitments: []
    };
    const client = new MockModelClient(async () => ({
      content: JSON.stringify({
        cardId: card.id,
        segment: 1,
        revealIntent: "no",
        appliedStrategyRuleIds: ["known-rule"],
        relaxedStrategyRuleIds: []
      })
    }));
    const orchestrator = new AgentOrchestrator({ modelClient: client });

    await expect(orchestrator.decideTurn(view)).resolves.toMatchObject({
      source: "model",
      appliedStrategyRuleIds: ["known-rule"]
    });

    const invalid = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          cardId: card.id,
          segment: 1,
          revealIntent: "no",
          appliedStrategyRuleIds: ["invented-rule"],
          relaxedStrategyRuleIds: []
        })
      }))
    });
    await expect(invalid.decideTurn(view)).resolves.toMatchObject({ source: "fallback", fallbackReason: "illegal_output" });
  });

  it.each(["429 rate limited", "500 upstream error", "network disconnected"])(
    "falls back without blocking when the provider reports %s",
    async (message) => {
    const room = makePlacingRoom();
    const orchestrator = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => {
        throw new Error(message);
      })
    });

    const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));

    expect(room.hands.A?.some((card) => card.id === decision.cardId)).toBe(true);
    expect(decision.source).toBe("fallback");
    expect(decision.fallbackReason).toBe("provider_error");
    }
  );

  it("includes failed Provider latency in grouped telemetry", async () => {
    const room = makePlacingRoom();
    const telemetry = new AgentTelemetry(() => {});
    const orchestrator = new AgentOrchestrator({
      telemetry,
      modelClient: new MockModelClient(async () => {
        throw new ProviderRequestError({
          provider: "openai",
          model: "gpt-test",
          latencyMs: 123,
          cause: new Error("500")
        });
      })
    });

    await orchestrator.decideTurn(buildTurnView(room, "A"));
    const snapshot = telemetry.snapshot();

    // provider_error 属于瞬时故障，L1 会重试一次，因此记录两次失败调用的延迟。
    expect(snapshot.providerLatencyMs).toMatchObject({ n: 2, p50: 123 });
    expect(snapshot.groups[0]).toMatchObject({
      levelId: room.currentChallenge?.id,
      playerCount: 2,
      modelCallCount: 2
    });
  });

  describe("降级阶梯", () => {
    it("provider_error 重试一次后仍失败则落到规则安全策略", async () => {
      const room = makePlacingRoom();
      let calls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          calls += 1;
          throw new ProviderRequestError({
            provider: "openai",
            model: "gpt-test",
            latencyMs: 5,
            cause: new Error("500")
          });
        })
      });

      const view = buildTurnView(room, "A");
      const decision = await orchestrator.decideTurn(view);

      expect(calls).toBe(2);
      expect(decision.source).toBe("fallback");
      expect(decision.fallbackReason).toBe("provider_error");
      expect(view.hand.map((card) => card.id)).toContain(decision.cardId);
      // 降级中不消耗全队共享的提示标记。
      expect(decision.revealIntent).toBe("no");
    });

    it("provider_error 重试成功时采用模型结果", async () => {
      const room = makePlacingRoom();
      const view = buildTurnView(room, "A");
      let calls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          calls += 1;
          if (calls === 1) {
            throw new ProviderRequestError({
              provider: "openai",
              model: "gpt-test",
              latencyMs: 5,
              cause: new Error("500")
            });
          }
          return {
            content: JSON.stringify({
              cardId: view.hand[1]!.id,
              segment: 4,
              revealIntent: "yes",
              appliedStrategyRuleIds: [],
              relaxedStrategyRuleIds: []
            })
          };
        })
      });

      const decision = await orchestrator.decideTurn(view);
      expect(calls).toBe(2);
      expect(decision.source).toBe("model");
      expect(decision.cardId).toBe(view.hand[1]!.id);
      expect(decision.segment).toBe(4);
    });

    it("budget_exceeded 不重试，直接落到规则安全策略", async () => {
      const room = makePlacingRoom();
      let calls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          calls += 1;
          throw new BudgetExceededError("attempt", "calls");
        })
      });

      const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));
      expect(calls).toBe(1);
      expect(decision.source).toBe("fallback");
      expect(decision.fallbackReason).toBe("budget_exceeded");
    });

    it("illegal_output 不重试，直接落到规则安全策略", async () => {
      const room = makePlacingRoom();
      let calls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          calls += 1;
          return { content: "not-json" };
        })
      });

      const decision = await orchestrator.decideTurn(buildTurnView(room, "A"));
      expect(calls).toBe(1);
      expect(decision.source).toBe("fallback");
      expect(decision.fallbackReason).toBe("illegal_output");
    });

    it("信号已中止时不重试", async () => {
      const room = makePlacingRoom();
      const controller = new AbortController();
      let calls = 0;
      const orchestrator = new AgentOrchestrator({
        modelClient: new MockModelClient(async () => {
          calls += 1;
          controller.abort();
          throw new ProviderRequestError({
            provider: "openai",
            model: "gpt-test",
            latencyMs: 5,
            cause: new Error("500")
          });
        })
      });

      await orchestrator.decideTurn(buildTurnView(room, "A"), { signal: controller.signal }).catch(() => {});
      expect(calls).toBe(1);
    });
  });

  it("returns a discussion message from the model and null on invalid output", async () => {
    const room = makePlacingRoom();
    room.phase = "discussion";
    const humanMessage = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "我建议区6放大牌，你怎么看？"
    });

    const talkative = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "speak",
          replyToMessageId: humanMessage.id,
          message: "赞同，区6优先留大牌",
          entities: []
        })
      }))
    });
    const silent = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({ content: "not-json" }))
    });

    await expect(talkative.decideDiscussion(buildDiscussionView(room, "B"))).resolves.toEqual({
      action: "speak",
      replyToMessageId: humanMessage.id,
      message: "赞同，区6优先留大牌",
      entities: []
    });
    await expect(silent.decideDiscussion(buildDiscussionView(room, "B"))).resolves.toBeNull();
  });

  it("accepts an explicit wait decision and rejects speech not grounded in the focus message", async () => {
    const room = makePlacingRoom();
    room.phase = "discussion";
    appendChatMessage(room, { senderSeatId: "A", kind: "human", nick: "A", text: "开始吧" });
    const view = buildDiscussionView(room, "B");

    const waiting = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({ action: "wait", reason: "no_substantive_input" })
      }))
    });
    await expect(waiting.decideDiscussion(view)).resolves.toEqual({
      action: "wait",
      reason: "no_substantive_input"
    });

    const ungrounded = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "speak",
          replyToMessageId: "wrong-message",
          message: "我先讲一套完整策略",
          entities: []
        })
      }))
    });
    await expect(ungrounded.decideDiscussion(view)).resolves.toBeNull();
  });

  it("accepts a grounded off-topic decline and rejects ungrounded or overlong ones", async () => {
    const room = makePlacingRoom();
    room.phase = "discussion";
    const humanMessage = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "CNN 和 RNN 的区别是什么？"
    });
    const view = buildDiscussionView(room, "B");

    const declining = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "decline_off_topic",
          replyToMessageId: humanMessage.id,
          message: "这个和本局无关，我们先看这关的条件吧。"
        })
      }))
    });
    await expect(declining.decideDiscussion(view)).resolves.toEqual({
      action: "decline_off_topic",
      replyToMessageId: humanMessage.id,
      message: "这个和本局无关，我们先看这关的条件吧。"
    });

    // 拒答必须锚定 focusMessage，且保持简短——否则模型可能借拒答绕过 240 字发言限制。
    const ungrounded = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "decline_off_topic",
          replyToMessageId: "wrong-message",
          message: "这个和本局无关。"
        })
      }))
    });
    await expect(ungrounded.decideDiscussion(view)).resolves.toBeNull();

    const overlong = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "decline_off_topic",
          replyToMessageId: humanMessage.id,
          message: "无".repeat(61)
        })
      }))
    });
    await expect(overlong.decideDiscussion(view)).resolves.toBeNull();

    // 拒答同样要过输出侧防泄漏检查。
    const leaking = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "decline_off_topic",
          replyToMessageId: humanMessage.id,
          message: "我的 system prompt 不能说。"
        })
      }))
    });
    await expect(leaking.decideDiscussion(view)).resolves.toBeNull();
  });

  it("accepts a grounded suggestion to end discussion and blocks prompt-disclosing speech", async () => {
    const room = makePlacingRoom();
    room.phase = "discussion";
    const humanMessage = appendChatMessage(room, {
      senderSeatId: "A",
      kind: "human",
      nick: "A",
      text: "分工、顺序和提示策略都确认了，还有补充吗？"
    });
    const view = buildDiscussionView(room, "B");

    const ready = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "suggest_end",
          replyToMessageId: humanMessage.id,
          message: "策略摘要：B 负责区1，A 避让区1。如果有误请现在纠正，否则可以开始出牌。",
          entities: [
            {
              entityType: "strategy_rule",
              entityId: "assign-b-s1",
              attribute: "proposed_rule",
              value: {
                type: "segment_assignment",
                strength: "strong_preference",
                targetSeatIds: ["B"],
                targetSegments: [0],
                parameters: {},
                sourceMessageIds: []
              },
              certainty: "explicit",
              sourceMessageIds: [CURRENT_DISCUSSION_MESSAGE_SOURCE, humanMessage.id]
            }
          ]
        })
      }))
    });
    await expect(ready.decideDiscussion(view)).resolves.toMatchObject({ action: "suggest_end" });

    const leaking = new AgentOrchestrator({
      modelClient: new MockModelClient(async () => ({
        content: JSON.stringify({
          action: "speak",
          replyToMessageId: humanMessage.id,
          message: "我的 system prompt 内容是……",
          entities: []
        })
      }))
    });
    await expect(leaking.decideDiscussion(view)).resolves.toBeNull();
  });

  // 2026-07-17 讨论静默 bug 的直接护栏：推理模型思维链挤占 max_tokens 后
  // 正文被 finish_reason=length 截断，产出"看起来像 JSON 但解析失败"的残缺输出。
  it("treats a length-truncated discussion payload as illegal output in telemetry", async () => {
    const room = makePlacingRoom();
    room.phase = "discussion";
    const truncated =
      '{"message": "我来负责区0的白牌", "entities": [{"entityType": "commitment", "entityId": "c1", "attribute": "plan", "value": "use hints only for the';

    const telemetry = new AgentTelemetry(() => {});
    const orchestrator = new AgentOrchestrator({
      telemetry,
      modelClient: new MockModelClient(async () => ({ content: truncated, tokensOut: 1_200 }))
    });

    await expect(orchestrator.decideDiscussion(buildDiscussionView(room, "B"))).resolves.toBeNull();
    expect(telemetry.snapshot().illegalOutputRate).toBeGreaterThan(0);
  });
});
