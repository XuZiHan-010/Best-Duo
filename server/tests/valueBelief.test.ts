import { describe, expect, it } from "vitest";
import type { Condition, PublicPlacedCard, TurnView } from "@take-time/shared";
import { decideHintFromBelief, inferHiddenCardBeliefs } from "../src/agent/belief/valueBelief.js";

const hidden = (id: string, owner: "A" | "B", color: "black" | "white", playOrder: number): PublicPlacedCard => ({
  id,
  owner,
  revealed: false,
  color,
  placedAt: playOrder,
  playOrder
});

const revealed = (id: string, owner: "A" | "B", color: "black" | "white", value: number, playOrder: number): PublicPlacedCard => ({
  id,
  owner,
  revealed: true,
  color,
  value,
  placedAt: playOrder,
  playOrder
});

const view = (placements: PublicPlacedCard[][], conditions: Condition[] = [], hand: TurnView["hand"] = []): TurnView => ({
  seatId: "A",
  attemptId: "attempt-1",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: { id: "lvl", name: "lvl", levelIndex: 1, difficulty: "x", centerCap: null, playable: true, conditions },
  settings: { thinkSeconds: 10, hintMarkerCount: 4 },
  seats: [
    { id: "A", kind: "agent", nick: "A" },
    { id: "B", kind: "human", nick: "B" }
  ],
  hand,
  placements,
  hintMarkers: { total: 4, used: 0 },
  turn: "A",
  pendingHint: null,
  playedCount: {}
});

describe("value belief v1", () => {
  it("未亮黑牌、无任何约束时，可能值为黑 1..12，期望 6.5", () => {
    const placements: PublicPlacedCard[][] = [[hidden("h1", "B", "black", 1)], [], [], [], [], []];
    const beliefs = inferHiddenCardBeliefs(view(placements));
    expect(beliefs).toHaveLength(1);
    expect(beliefs[0]).toMatchObject({ cardId: "h1", owner: "B", segment: 0, color: "black" });
    expect(beliefs[0]!.possibleValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(beliefs[0]!.successCompatibleValues).toEqual(beliefs[0]!.possibleValues);
    expect(beliefs[0]!.status).toBe("estimated");
    expect(beliefs[0]!.expected).toBeCloseTo(6.5);
  });

  it("牌堆核账：同色已知值（我的手牌 + 已亮牌）从可能值中剔除", () => {
    const placements: PublicPlacedCard[][] = [
      [hidden("h1", "B", "black", 3)],
      [revealed("r1", "A", "black", 3, 1)],
      [], [], [], []
    ];
    const hand: TurnView["hand"] = [{ id: "m1", owner: "A", visibleToOwner: true, value: 5, color: "black" }];
    const beliefs = inferHiddenCardBeliefs(view(placements, [], hand));
    expect(beliefs[0]!.possibleValues).toEqual([1, 2, 4, 6, 7, 8, 9, 10, 11, 12]);
    expect(beliefs[0]!.possibleValues).not.toContain(3);
    expect(beliefs[0]!.possibleValues).not.toContain(5);
  });

  it("不同色的已知值不影响本色可能值", () => {
    const placements: PublicPlacedCard[][] = [
      [hidden("h1", "B", "black", 2)],
      [revealed("r1", "A", "white", 4, 1)],
      [], [], [], []
    ];
    const beliefs = inferHiddenCardBeliefs(view(placements));
    expect(beliefs[0]!.possibleValues).toContain(4); // 白 4 不占用黑池
  });

  it("胜利条件只收窄成功兼容值，不伪造物理不可能", () => {
    const placements: PublicPlacedCard[][] = [[hidden("h1", "B", "black", 8)], [], [], [], [], []];
    const conditions: Condition[] = [{ type: "forbidden-values", segment: 0, values: [1, 2, 3] }];
    const beliefs = inferHiddenCardBeliefs(view(placements, conditions));
    expect(beliefs[0]!.possibleValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(beliefs[0]!.successCompatibleValues).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("all-distinct 剔除该段已出现的数值（不能重复）", () => {
    const placements: PublicPlacedCard[][] = [
      [revealed("r1", "A", "white", 6, 1), hidden("h1", "B", "black", 9)],
      [], [], [], []
    ];
    const conditions: Condition[] = [{ type: "all-distinct", segment: 0 }];
    const beliefs = inferHiddenCardBeliefs(view(placements, conditions));
    expect(beliefs[0]!.possibleValues).toContain(6);
    expect(beliefs[0]!.successCompatibleValues).not.toContain(6); // 成功条件不允许重复
  });

  it("sum 上限：未亮牌值不能超过该段剩余额度", () => {
    // 段 0 已有已亮白 8；sum-range 上限 12 → 未亮黑牌值 <= 4。
    const placements: PublicPlacedCard[][] = [
      [revealed("r1", "A", "white", 8, 1), hidden("h1", "B", "black", 2)],
      [], [], [], [], []
    ];
    const conditions: Condition[] = [{ type: "sum-range", segment: 0, min: 0, max: 12 }];
    const beliefs = inferHiddenCardBeliefs(view(placements, conditions));
    expect(beliefs[0]!.possibleValues).toContain(12);
    expect(beliefs[0]!.successCompatibleValues.every((v) => v <= 4)).toBe(true);
  });

  it("只对未亮桌面牌生成信念：已亮牌与自己手牌一律排除", () => {
    const placements: PublicPlacedCard[][] = [
      [revealed("r1", "A", "white", 5, 1)],
      [hidden("h1", "B", "black", 9)],
      [], [], [], []
    ];
    const hand: TurnView["hand"] = [{ id: "m1", owner: "A", visibleToOwner: true, value: 7, color: "black" }];
    const beliefs = inferHiddenCardBeliefs(view(placements, [], hand));
    expect(beliefs).toHaveLength(1);
    expect(beliefs.map((b) => b.cardId)).toEqual(["h1"]);
  });

  it("额度耗尽时保留显式 inconsistent 信念", () => {
    // 段 0 已有已亮白 12、上限 12 → 未亮牌无正数值可放。
    const placements: PublicPlacedCard[][] = [
      [revealed("r1", "A", "white", 12, 1), hidden("h1", "B", "black", 1)],
      [], [], [], [], []
    ];
    const conditions: Condition[] = [{ type: "sum-range", segment: 0, min: 0, max: 12 }];
    expect(() => inferHiddenCardBeliefs(view(placements, conditions))).not.toThrow();
    const beliefs = inferHiddenCardBeliefs(view(placements, conditions));
    expect(beliefs.find((b) => b.cardId === "h1")).toMatchObject({
      status: "inconsistent",
      successCompatibleValues: []
    });
  });

  it("记住本座位落子时合法可见的牌值", () => {
    const current = view([[hidden("own", "A", "black", 1)], [], [], [], [], []]);
    current.memory = {
      lockedSeatStrategy: null,
      ownActions: [{
        kind: "placement",
        payload: { cardId: "own", segment: 0, knownValue: 9, knownColor: "black" },
        appliedStrategyRuleIds: []
      }],
      currentBeliefs: [],
      pendingCommitments: []
    };
    expect(inferHiddenCardBeliefs(current)[0]).toMatchObject({
      status: "known",
      possibleValues: [9],
      successCompatibleValues: [9],
      expected: 9
    });
  });

  it("讨论 value_band 只软调权，不删除物理可能值", () => {
    const current = view([[hidden("h1", "B", "black", 1)], [], [], [], [], []]);
    current.memory = {
      lockedSeatStrategy: {
        version: 1,
        rules: [{
          id: "high-band",
          type: "value_band",
          strength: "strong_preference",
          targetSeatIds: ["B"],
          targetSegments: [0],
          parameters: { min: 10, max: 12 },
          sourceMessageIds: ["m1"]
        }],
        privatePlan: []
      },
      ownActions: [],
      currentBeliefs: [],
      pendingCommitments: []
    };
    const belief = inferHiddenCardBeliefs(current)[0]!;
    expect(belief.possibleValues).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(belief.expected).toBeGreaterThan(6.5);
    expect(belief.evidence).toContain("seat_strategy");
  });

  it("只在共享且信息敏感的区段使用 belief 提示信号", () => {
    const current = view(
      [[hidden("team", "B", "black", 1)], [], [], [], [], []],
      [{ type: "sum-equals", segment: 0, value: 12 }],
      [{ id: "high", owner: "A", visibleToOwner: true, value: 11, color: "white" }]
    );
    expect(decideHintFromBelief(current, "high", 0)).toBe("yes");
    expect(decideHintFromBelief(current, "high", 1)).toBe("no");
  });

  it("把奇偶条件视为提示可传递的数值信息", () => {
    const current = view(
      [[hidden("team", "B", "black", 1)], [], [], [], [], []],
      [{ type: "parity", segment: 0, parity: "odd" }],
      [{ id: "high", owner: "A", visibleToOwner: true, value: 11, color: "white" }]
    );
    expect(decideHintFromBelief(current, "high", 0)).toBe("yes");
  });
});
