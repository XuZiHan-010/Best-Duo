import type { SeatId, TurnStrategyRuleView } from "@take-time/shared";
import { generateCandidates } from "../agent/candidates/index.js";
import { frozenM93Fixtures } from "./benchmark.js";
import { collectReasonablenessRun } from "./reasonablenessRunner.js";
import {
  summarizeHints,
  summarizeReasonableness,
  type HintRecord,
  type HintSummary,
  type PlacementRecord,
  type ReasonablenessSummary
} from "./reasonableness.js";

const seatOrder: SeatId[] = ["A", "B", "C", "D"];

export interface GoalBReport {
  fixtures: number;
  overall: ReasonablenessSummary;
  hints: HintSummary;
  byLevel: Record<string, ReasonablenessSummary>;
}

// 合成分工：把 6 个区段按座位数轮流分配，保证每座位都有一份非空 segment_assignment，
// 用来度量候选引擎在「锁定分工」下的遵守率（不是产品讨论产物，只是评测夹具）。
const assignmentRules = (playerCount: number): Partial<Record<SeatId, TurnStrategyRuleView[]>> => {
  const rules: Partial<Record<SeatId, TurnStrategyRuleView[]>> = {};
  seatOrder.slice(0, playerCount).forEach((seatId, index) => {
    const targetSegments = [0, 1, 2, 3, 4, 5].filter((segment) => segment % playerCount === index);
    rules[seatId] = [
      {
        id: `goalB-${seatId}`,
        type: "segment_assignment",
        strength: "hard_commitment",
        targetSeatIds: [seatId],
        targetSegments,
        parameters: {},
        sourceMessageIds: []
      }
    ];
  });
  return rules;
};

// Goal B 报告：用候选引擎（合理落子层）逐手跑 frozen fixtures，产出胜率无关的
// 合理性汇总——可行率、可避免必输数、锁定分工遵守率。
export const runGoalBReasonableness = (options: { seedsPerLevel?: number } = {}): GoalBReport => {
  const fixtures = frozenM93Fixtures(options.seedsPerLevel ?? 60);
  const allRecords: PlacementRecord[] = [];
  const allHints: HintRecord[] = [];
  const recordsByLevel: Record<string, PlacementRecord[]> = {};

  for (const fixture of fixtures) {
    const run = collectReasonablenessRun(
      fixture,
      (view) => {
        const first = generateCandidates(view).ranked[0]!;
        return { cardId: first.cardId, segment: first.segment };
      },
      assignmentRules(fixture.playerCount)
    );
    allRecords.push(...run.placements);
    allHints.push(...run.hints);
    (recordsByLevel[fixture.levelId] ??= []).push(...run.placements);
  }

  return {
    fixtures: fixtures.length,
    overall: summarizeReasonableness(allRecords),
    hints: summarizeHints(allHints),
    byLevel: Object.fromEntries(
      Object.entries(recordsByLevel).map(([levelId, records]) => [levelId, summarizeReasonableness(records)])
    )
  };
};
