import { describe, expect, it } from "vitest";
import type { Condition, TurnStrategyRuleView, TurnView } from "@take-time/shared";
import {
  assignedSegmentsForSeat,
  recordHint,
  recordPlacement,
  summarizeHints,
  summarizeReasonableness,
  type HintRecord,
  type PlacementRecord
} from "../src/agentlab/reasonableness.js";
import { collectReasonablenessRecords } from "../src/agentlab/reasonablenessRunner.js";
import { runGoalBReasonableness } from "../src/agentlab/reasonablenessBenchmark.js";
import type { EvalFixture } from "../src/agentlab/fixtures.js";

const view = (opts: {
  conditions?: Condition[];
  rules?: TurnStrategyRuleView[];
  hand?: TurnView["hand"];
  placements?: TurnView["placements"];
  hintMarkers?: TurnView["hintMarkers"];
}): TurnView => ({
  seatId: "A",
  attemptId: "a1",
  phaseVersion: 1,
  turnVersion: 1,
  phase: "placing",
  level: { id: "lvl", name: "lvl", levelIndex: 1, difficulty: "x", centerCap: null, playable: true, conditions: opts.conditions ?? [] },
  settings: { thinkSeconds: 10, hintMarkerCount: 4 },
  seats: [
    { id: "A", kind: "agent", nick: "A" },
    { id: "B", kind: "human", nick: "B" }
  ],
  hand: opts.hand ?? [],
  placements: opts.placements ?? [[], [], [], [], [], []],
  hintMarkers: opts.hintMarkers ?? { total: 4, used: 0 },
  turn: "A",
  pendingHint: null,
  playedCount: {},
  memory: opts.rules
    ? { lockedSeatStrategy: { version: 1, rules: opts.rules, privatePlan: [] }, ownActions: [], currentBeliefs: [], pendingCommitments: [] }
    : undefined
});

describe("goal B: reasonable-teammate metrics", () => {
  it("空记录返回空态汇总（可行率/遵守率按 1 处理）", () => {
    const summary = summarizeReasonableness([]);
    expect(summary.placements).toBe(0);
    expect(summary.plausibilityRate).toBe(1);
    expect(summary.assignedPlacements).toBe(0);
    expect(summary.adherenceRate).toBe(1);
  });

  it("可行率 = 非可证必输落子占比", () => {
    const records: PlacementRecord[] = [
      { seatId: "A", segment: 0, provablyLosing: false, forced: false, assignedSegments: null },
      { seatId: "A", segment: 1, provablyLosing: true, forced: false, assignedSegments: null },
      { seatId: "A", segment: 2, provablyLosing: false, forced: false, assignedSegments: null }
    ];
    expect(summarizeReasonableness(records).plausibilityRate).toBeCloseTo(2 / 3);
  });

  it("遵守率只统计有分工的座位，且看是否落在被指派区段", () => {
    const records: PlacementRecord[] = [
      { seatId: "A", segment: 0, provablyLosing: false, forced: false, assignedSegments: [0] }, // 遵守
      { seatId: "A", segment: 3, provablyLosing: false, forced: false, assignedSegments: [0] }, // 违背
      { seatId: "B", segment: 5, provablyLosing: false, forced: false, assignedSegments: null } // 无分工，不计
    ];
    const summary = summarizeReasonableness(records);
    expect(summary.assignedPlacements).toBe(2);
    expect(summary.adherenceRate).toBeCloseTo(0.5);
  });

  it("avoidableLosses 只数「有安全选择却仍必输」的手；被迫必输不计", () => {
    const records: PlacementRecord[] = [
      { seatId: "A", segment: 0, provablyLosing: true, forced: true, assignedSegments: null }, // 被迫，不算
      { seatId: "A", segment: 1, provablyLosing: true, forced: false, assignedSegments: null }, // 可避免，算
      { seatId: "A", segment: 2, provablyLosing: false, forced: false, assignedSegments: null }
    ];
    const summary = summarizeReasonableness(records);
    expect(summary.avoidableLosses).toBe(1);
  });

  it("assignedSegmentsForSeat 从锁定策略读出本座位被指派区段，无则为 null", () => {
    const rules: TurnStrategyRuleView[] = [
      { id: "r1", type: "segment_assignment", strength: "hard_commitment", targetSeatIds: ["A"], targetSegments: [1, 4], parameters: {}, sourceMessageIds: [] }
    ];
    const v = view({ rules });
    expect(assignedSegmentsForSeat(v, "A")).toEqual([1, 4]);
    expect(assignedSegmentsForSeat(v, "B")).toBeNull();
    expect(assignedSegmentsForSeat(view({}), "A")).toBeNull();
  });

  it("recordPlacement 逐手判定可证必输 + 记录分工", () => {
    const conditions: Condition[] = [{ type: "max-cards", segment: 0, count: 0 }];
    const rules: TurnStrategyRuleView[] = [
      { id: "r1", type: "segment_assignment", strength: "hard_commitment", targetSeatIds: ["A"], targetSegments: [1], parameters: {}, sourceMessageIds: [] }
    ];
    const hand: TurnView["hand"] = [{ id: "c1", owner: "A", visibleToOwner: true, value: 5, color: "black" }];
    const v = view({ conditions, rules, hand });
    // 段 0 max-cards=0 → 放这里必输；段 1 合法。段 1-5 均是安全选择 → 非被迫。
    expect(recordPlacement(v, "A", "c1", 0)).toEqual({ seatId: "A", segment: 0, provablyLosing: true, forced: false, assignedSegments: [1] });
    expect(recordPlacement(v, "A", "c1", 1)).toEqual({ seatId: "A", segment: 1, provablyLosing: false, forced: false, assignedSegments: [1] });
  });

  it("recordHint 记录剩余标记 + 区段信息敏感/共享", () => {
    const placements: TurnView["placements"] = [[], [], [{ id: "b1", owner: "B", color: "black", value: null }], [], [], []];
    const v = view({
      conditions: [{ type: "sum-range", segment: 2, min: 8, max: 12 }],
      placements,
      hintMarkers: { total: 4, used: 1 }
    });
    expect(recordHint(v, "A", "cX", 2, "yes")).toEqual({
      decision: "yes",
      markersLeftBefore: 3,
      segmentInformationSensitive: true,
      segmentShared: true
    });
    // 段 0 无信息敏感条件、也无他人牌。
    expect(recordHint(v, "A", "cX", 0, "no")).toEqual({
      decision: "no",
      markersLeftBefore: 3,
      segmentInformationSensitive: false,
      segmentShared: false
    });
  });

  it("summarizeHints 统计揭示、超预算揭示、浪费揭示", () => {
    const hints: HintRecord[] = [
      { decision: "yes", markersLeftBefore: 2, segmentInformationSensitive: true, segmentShared: true }, // 合理揭示
      { decision: "yes", markersLeftBefore: 0, segmentInformationSensitive: true, segmentShared: true }, // 超预算
      { decision: "yes", markersLeftBefore: 2, segmentInformationSensitive: false, segmentShared: true }, // 浪费
      { decision: "no", markersLeftBefore: 2, segmentInformationSensitive: true, segmentShared: true }
    ];
    const summary = summarizeHints(hints);
    expect(summary.hintDecisions).toBe(4);
    expect(summary.reveals).toBe(3);
    expect(summary.overBudgetReveals).toBe(1);
    expect(summary.wastefulReveals).toBe(1);
    expect(summary.revealRate).toBeCloseTo(3 / 4);
  });

  it("整局驱动器：注入分工后逐手产出结构良好的记录", () => {
    const fixture: EvalFixture = {
      suiteVersion: "goalB-smoke",
      levelId: "level-01",
      playerCount: 2,
      seatPolicies: { A: "scripted", B: "scripted" },
      dealSeed: "goalB:level-01:2:0",
      samplingSeed: "goalB-sampling:level-01:2:0"
    };
    // 确定性策略：把 hand[0] 放到牌数最少的区段。
    const decide = (v: TurnView) => {
      const loads = v.placements.map((seg, i) => ({ i, n: seg.length }));
      loads.sort((a, b) => a.n - b.n || a.i - b.i);
      return { cardId: v.hand[0]!.id, segment: loads[0]!.i };
    };
    const records = collectReasonablenessRecords(fixture, decide, {
      A: [{ id: "r1", type: "segment_assignment", strength: "hard_commitment", targetSeatIds: ["A"], targetSegments: [0], parameters: {}, sourceMessageIds: [] }]
    });
    expect(records).toHaveLength(12); // 12 张全部放完
    expect(records.every((r) => r.segment >= 0 && r.segment <= 5)).toBe(true);
    expect(records.some((r) => r.seatId === "A" && r.assignedSegments !== null)).toBe(true); // A 有分工
    expect(records.some((r) => r.seatId === "B" && r.assignedSegments === null)).toBe(true); // B 无分工
    const summary = summarizeReasonableness(records);
    expect(summary.plausibilityRate).toBeGreaterThanOrEqual(0);
    expect(summary.plausibilityRate).toBeLessThanOrEqual(1);
    expect(summary.assignedPlacements).toBeGreaterThan(0);
  });

  it("Goal-B 报告：候选引擎跑 frozen fixtures 产出合理性汇总", () => {
    const report = runGoalBReasonableness({ seedsPerLevel: 2 });
    expect(report.fixtures).toBe(6); // 3 关 × 2 seed
    expect(report.overall.placements).toBeGreaterThan(0);
    for (const rate of [report.overall.plausibilityRate, report.overall.adherenceRate]) {
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    }
    // 候选引擎是「合理落子层」的真不变式：绝不「有安全选择却仍必输」。
    expect(report.overall.avoidableLosses).toBe(0);
    // 注入硬分工后，遵守率应显著（候选层硬过滤到被指派区段）。
    expect(report.overall.adherenceRate).toBeGreaterThan(0.5);
    // hint 策略合理性不变式：不在无标记时揭示、不揭示到无信息价值的区段。
    expect(report.hints.overBudgetReveals).toBe(0);
    expect(report.hints.wastefulReveals).toBe(0);
    expect(Object.keys(report.byLevel).sort()).toEqual(["level-01", "level-04", "level-08"]);
  });
});
