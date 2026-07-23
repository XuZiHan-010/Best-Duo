import { describe, expect, it } from "vitest";
import type { PublicHandCard, TurnStrategyRuleView, TurnView } from "@take-time/shared";
import { generateCandidates } from "../src/agent/candidates/index.js";
import { decideHintFromPolicy } from "../src/agent/strategy/interpreters.js";

const baseView = (rules: TurnStrategyRuleView[]): TurnView => ({
  seatId: "A",
  attemptId: "attempt",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: null,
  settings: { thinkSeconds: 10, hintMarkerCount: 3 },
  seats: [{ id: "A", kind: "agent", nick: "AI" }],
  hand: [
    { id: "low", value: 2, color: "white" },
    { id: "high", value: 11, color: "black" }
  ] as PublicHandCard[],
  placements: [[], [], [], [], [], []],
  hintMarkers: { total: 3, used: 0 },
  turn: "A",
  pendingHint: null,
  playedCount: {},
  memory: {
    lockedSeatStrategy: { version: 1, rules, privatePlan: [] },
    ownActions: [],
    currentBeliefs: [],
    pendingCommitments: []
  }
});

const makeRule = (
  type: TurnStrategyRuleView["type"],
  parameters: Record<string, unknown>,
  targetSegments = [0],
  strength: TurnStrategyRuleView["strength"] = "strong_preference"
): TurnStrategyRuleView => ({
  id: `${type}-1`,
  type,
  strength,
  targetSeatIds: ["A"],
  targetSegments,
  parameters,
  sourceMessageIds: ["m1"]
});

describe("strategy DSL interpreters", () => {
  it("scores value_band and color_allocation toward the executable contract", () => {
    const result = generateCandidates(
      baseView([
        makeRule("value_band", { min: 1, max: 4 }),
        makeRule("color_allocation", { color: "white", min: 1 })
      ])
    );
    expect(result.ranked[0]).toMatchObject({ cardId: "low", segment: 0 });
    expect(result.ranked[0]?.appliedRuleIds).toEqual(expect.arrayContaining(["value_band-1", "color_allocation-1"]));
  });

  it("applies hard placement_order and structurally relaxes an impossible reserve_capacity", () => {
    const view = baseView([
      makeRule("placement_order", { order: 1 }, [2], "hard_commitment"),
      makeRule("reserve_capacity", { maxCards: 1 }, [2], "hard_commitment")
    ]);
    view.placements[2] = [{ id: "placed", owner: "B", color: "white", placedAt: 1, playOrder: 1 }];
    // 下一手 order=2，因此 placement_order 当前不约束；reserve_capacity 会禁止 S3，但仍有其它候选。
    const result = generateCandidates(view);
    expect(result.ranked.some((candidate) => candidate.segment === 2)).toBe(false);
    expect(result.relaxations).toEqual([]);
  });

  it("executes hint_policy without a model decision", () => {
    const policy = makeRule("hint_policy", { mode: "high_information", minMarkers: 1 }, [], "hard_commitment");
    expect(decideHintFromPolicy(baseView([policy]), "high")).toEqual({
      intent: "yes",
      appliedRuleIds: [policy.id]
    });
    expect(decideHintFromPolicy(baseView([policy]), "low")?.intent).toBe("yes");
  });

  it("does not promote an unconfirmed hint preference into a hard decision", () => {
    const preference = makeRule(
      "hint_policy",
      { mode: "never", minMarkers: 1 },
      [],
      "strong_preference"
    );
    const suggestion = makeRule(
      "hint_policy",
      { mode: "always_known", minMarkers: 1 },
      [],
      "suggestion"
    );
    expect(decideHintFromPolicy(baseView([preference]), "high")).toBeNull();
    expect(decideHintFromPolicy(baseView([suggestion]), "high")).toBeNull();
  });
});
