import type { Condition, SeatId, TurnView } from "@take-time/shared";
import { isPlacementProvablyLosing } from "../agent/safePolicy.js";

// Goal B「合理队友」指标：不以胜负为准，衡量 Agent 出牌是否合理、是否遵守约定。
// 每条记录描述一次落子：是否可证必输、以及（若该座位有分工）是否落在被指派区段。
export interface PlacementRecord {
  seatId: SeatId;
  segment: number;
  provablyLosing: boolean;
  forced: boolean; // 落子前本座位已无任何非必输可选（局面已死），此时必输不算失误
  assignedSegments: number[] | null; // null = 该座位本局无 segment_assignment
}

export interface ReasonablenessSummary {
  placements: number;
  plausibilityRate: number; // 非可证必输落子占比；无落子按 1
  avoidableLosses: number; // 「有安全选择却仍必输」的手数；合理队友应为 0
  assignedPlacements: number; // 有分工的座位的落子数
  adherenceRate: number; // 有分工的落子里落在被指派区段的占比；无则按 1
}

const SEGMENT_COUNT = 6;

// 落子前是否已「无路可走」：本座位任何可见牌放到任何区段都可证必输。
const isForced = (view: TurnView): boolean => {
  for (const card of view.hand) {
    for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
      if (!isPlacementProvablyLosing(view, card.id, segment)) return false;
    }
  }
  return true;
};

// 本座位在锁定策略里被 segment_assignment 指派的区段并集；无分工返回 null。
export const assignedSegmentsForSeat = (view: TurnView, seatId: SeatId): number[] | null => {
  const rules = view.memory?.lockedSeatStrategy?.rules ?? [];
  const segments = new Set<number>();
  let hasAssignment = false;
  for (const rule of rules) {
    if (rule.type !== "segment_assignment" || rule.strength === "unresolved") continue;
    if (!rule.targetSeatIds.includes(seatId)) continue;
    hasAssignment = true;
    for (const segment of rule.targetSegments ?? []) segments.add(segment);
  }
  return hasAssignment ? [...segments].sort((a, b) => a - b) : null;
};

// 逐手记录：落子前的视图决定可证必输与否；分工来自该座位锁定策略。
export const recordPlacement = (
  view: TurnView,
  seatId: SeatId,
  cardId: string,
  segment: number
): PlacementRecord => ({
  seatId,
  segment,
  provablyLosing: isPlacementProvablyLosing(view, cardId, segment),
  forced: isForced(view),
  assignedSegments: assignedSegmentsForSeat(view, seatId)
});

// ── hint（提示标记）合理性 ─────────────────────────────────────────────
// 独立于 belief 策略内部的客观事实度量：一次揭示只有在「信息敏感 + 共享区段」
// 才可能帮到队友，且不得在无标记时发生。用于守护 decideHintFromBelief 不退化。
export interface HintRecord {
  decision: "yes" | "no";
  markersLeftBefore: number;
  segmentInformationSensitive: boolean; // 该区段有靠数值判断的条件（sum/parity/distinct 等）
  segmentShared: boolean; // 该区段已放有他人的牌（揭示才对队友有协调价值）
}

export interface HintSummary {
  hintDecisions: number;
  reveals: number;
  revealRate: number;
  overBudgetReveals: number; // 无标记却仍揭示；应为 0
  wastefulReveals: number; // 揭示到非「信息敏感且共享」的区段；应为 0
}

// 度量口径自带的「信息敏感条件」集合：这些条件的成败取决于具体数值，
// 因此揭示一张牌的数值对队友有信息价值。与 belief 策略各自独立判断。
const INFORMATION_SENSITIVE = new Set<Condition["type"]>([
  "sum-equals",
  "sum-range",
  "max-sum-each",
  "forbidden-values",
  "all-distinct",
  "closest-to-value",
  "adjacent-diff",
  "non-decreasing",
  "non-increasing",
  "parity"
]);

const isInformationSensitiveSegment = (view: TurnView, segment: number): boolean =>
  (view.level?.conditions ?? []).some((condition) => {
    if (!INFORMATION_SENSITIVE.has(condition.type)) return false;
    if ("segment" in condition) return condition.segment === segment;
    if ("segments" in condition) return condition.segments.includes(segment);
    return condition.type === "max-sum-each";
  });

export const recordHint = (
  view: TurnView,
  seatId: SeatId,
  _cardId: string,
  segment: number,
  decision: "yes" | "no"
): HintRecord => ({
  decision,
  markersLeftBefore: Math.max(0, view.hintMarkers.total - view.hintMarkers.used),
  segmentInformationSensitive: isInformationSensitiveSegment(view, segment),
  segmentShared: (view.placements[segment] ?? []).some((placed) => placed.owner !== seatId)
});

export const summarizeHints = (hints: HintRecord[]): HintSummary => {
  const reveals = hints.filter((hint) => hint.decision === "yes");
  return {
    hintDecisions: hints.length,
    reveals: reveals.length,
    revealRate: hints.length === 0 ? 0 : reveals.length / hints.length,
    overBudgetReveals: reveals.filter((hint) => hint.markersLeftBefore <= 0).length,
    wastefulReveals: reveals.filter((hint) => !(hint.segmentInformationSensitive && hint.segmentShared)).length
  };
};

export const summarizeReasonableness = (records: PlacementRecord[]): ReasonablenessSummary => {
  const placements = records.length;
  const nonLosing = records.filter((record) => !record.provablyLosing).length;
  const avoidableLosses = records.filter((record) => record.provablyLosing && !record.forced).length;
  const assigned = records.filter((record) => record.assignedSegments !== null);
  const adhered = assigned.filter((record) => record.assignedSegments!.includes(record.segment)).length;
  return {
    placements,
    plausibilityRate: placements === 0 ? 1 : nonLosing / placements,
    avoidableLosses,
    assignedPlacements: assigned.length,
    adherenceRate: assigned.length === 0 ? 1 : adhered / assigned.length
  };
};
