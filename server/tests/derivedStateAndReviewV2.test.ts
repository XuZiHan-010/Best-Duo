import { describe, expect, it } from "vitest";
import type { TurnView } from "@take-time/shared";
import { deriveTurnState } from "../src/agent/memory/derivedState.js";
import { AttemptMemoryStore } from "../src/agent/memory/attemptMemoryStore.js";

const view = (): TurnView => ({
  seatId: "A",
  attemptId: "attempt-1",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: {
    id: "level-x",
    name: "x",
    levelIndex: 1,
    difficulty: "x",
    centerCap: null,
    playable: true,
    conditions: [{ type: "sum-equals", segment: 0, value: 5 }]
  },
  settings: { thinkSeconds: 10, hintMarkerCount: 4 },
  seats: [
    { id: "A", kind: "agent", nick: "A" },
    { id: "B", kind: "human", nick: "B" }
  ],
  hand: [],
  placements: [[], [], [], [], [], []],
  segmentKnowledge: [
    { count: 1, revealedSum: 8, hiddenCount: 0, blackCount: 1, whiteCount: 0, sumLowerBound: 8, sumUpperBound: 8 },
    ...Array.from({ length: 5 }, () => ({
      count: 0, revealedSum: 0, hiddenCount: 0, blackCount: 0, whiteCount: 0, sumLowerBound: 0, sumUpperBound: 0
    }))
  ],
  hintMarkers: { total: 4, used: 0 },
  turn: "A",
  pendingHint: null,
  playedCount: {},
  memory: {
    lockedSeatStrategy: null,
    ownActions: [],
    currentBeliefs: [],
    pendingCommitments: [{
      id: "commitment-1",
      ruleId: "rule-1",
      description: "放到 S1",
      status: "relaxed",
      reason: "无可执行候选",
      sourceMessageIds: ["message-1"]
    }]
  }
});

describe("M9.3 derived state and review v2", () => {
  it("只从公开 TurnView 推导可证不可能条件和承诺状态", () => {
    const state = deriveTurnState(view());
    expect(state.conditions[0]).toMatchObject({ status: "impossible" });
    expect(state.commitments[0]).toEqual({ ruleId: "rule-1", status: "relaxed", reason: "无可执行候选" });
  });

  it("模型 lessons 只能追加，不能覆盖确定性发现和契约结果", () => {
    const store = new AttemptMemoryStore();
    store.beginAttempt({
      campaignId: "campaign",
      playSessionId: "session",
      levelRunId: "run",
      levelId: "level-x",
      attemptId: "attempt-1"
    });
    store.setStrategyDraft("A", {
      rules: [{
        id: "rule-1",
        type: "segment_assignment",
        strength: "hard_commitment",
        targetSeatIds: ["A"],
        targetSegments: [0],
        parameters: {},
        sourceMessageIds: ["message-1"]
      }],
      privatePlan: []
    });
    store.lockStrategy("A");
    store.applyRuleOutcomes("A", [], ["rule-1"]);
    const brief = store.finishAttempt({ failedSegments: [0], passedSegments: [1, 2, 3, 4, 5], failureReason: "rule-unmet" });
    expect(brief?.contractOutcomes).toEqual([
      expect.objectContaining({ ruleId: "rule-1", status: "relaxed" })
    ]);
    const enriched = store.updateRetryBriefLessons("attempt-1", [
      { description: "模型建议调整分工", confidence: 0.7, sourceIds: [] }
    ]);
    expect(enriched?.deterministicFindings.length).toBeGreaterThan(0);
    expect(enriched?.modelLessons).toHaveLength(1);
    expect(enriched?.lessons.some((lesson) => lesson.description.includes("未满足区段"))).toBe(true);
    expect(enriched?.lessons.at(-1)?.description).toBe("模型建议调整分工");
  });
});
