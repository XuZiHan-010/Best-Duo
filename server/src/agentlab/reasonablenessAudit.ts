import type { Condition, PublicHandCard, PublicPlacedCard, TurnView } from "@take-time/shared";
import type { SeatPolicyDecision } from "./seatPolicies.js";
import { inferHiddenCardBeliefs } from "../agent/belief/valueBelief.js";

// 发布评测的审计器必须独立于 candidates/safePolicy 的实现，避免用生成
// 候选时的同一个函数给候选结果自证。这里只消费落子前的安全 TurnView。
const SEGMENT_COUNT = 6;
const TOTAL_CARDS = 12;
const MIN_VALUE = 1;
const MAX_VALUE = 12;

interface SegmentAuditStats {
  count: number;
  revealedSum: number;
  hiddenCount: number;
  black: number;
  white: number;
  revealedValues: number[];
}

const statsOf = (placements: PublicPlacedCard[][]): SegmentAuditStats[] =>
  Array.from({ length: SEGMENT_COUNT }, (_, segment) => {
    const stats: SegmentAuditStats = {
      count: 0,
      revealedSum: 0,
      hiddenCount: 0,
      black: 0,
      white: 0,
      revealedValues: []
    };
    for (const card of placements[segment] ?? []) {
      stats.count += 1;
      if (typeof card.value === "number") {
        stats.revealedSum += card.value;
        stats.revealedValues.push(card.value);
      } else {
        stats.hiddenCount += 1;
      }
      if (card.color === "black") stats.black += 1;
      if (card.color === "white") stats.white += 1;
    }
    return stats;
  });

const addCard = (stats: SegmentAuditStats, card: PublicHandCard): SegmentAuditStats => ({
  count: stats.count + 1,
  revealedSum: stats.revealedSum + (typeof card.value === "number" ? card.value : 0),
  hiddenCount: stats.hiddenCount + (typeof card.value === "number" ? 0 : 1),
  black: stats.black + (card.color === "black" ? 1 : 0),
  white: stats.white + (card.color === "white" ? 1 : 0),
  revealedValues:
    typeof card.value === "number" ? [...stats.revealedValues, card.value] : [...stats.revealedValues]
});

const lowerSum = (stats: SegmentAuditStats) => stats.revealedSum + stats.hiddenCount * MIN_VALUE;
const upperSum = (stats: SegmentAuditStats) => stats.revealedSum + stats.hiddenCount * MAX_VALUE;

const requiredCount = (stats: SegmentAuditStats, conditions: Condition[], segment: number): number => {
  let required = stats.count > 0 ? 0 : 1;
  for (const condition of conditions) {
    if (
      (condition.type === "min-cards" || condition.type === "exact-cards") &&
      condition.segment === segment
    ) {
      required = Math.max(required, condition.count);
    } else if (condition.type === "segment-colors" && condition.segment === segment) {
      required = Math.max(required, condition.black + condition.white);
    } else if (condition.type === "min-color-cards" && condition.segment === segment) {
      required = Math.max(required, condition.count);
    }
  }
  return Math.max(0, required - stats.count);
};

const isPlacementIndependentlySafe = (
  view: TurnView,
  decision: Pick<SeatPolicyDecision, "cardId" | "segment">
): boolean => {
  const card = view.hand.find((candidate) => candidate.id === decision.cardId);
  if (!card || !Number.isInteger(decision.segment) || decision.segment < 0 || decision.segment >= SEGMENT_COUNT) {
    return false;
  }

  const conditions = view.level?.conditions ?? [];
  const before = statsOf(view.placements);
  const after = before.map((stats, segment) =>
    segment === decision.segment ? addCard(stats, card) : stats
  );
  const target = after[decision.segment]!;
  const placedAfter = after.reduce((total, stats) => total + stats.count, 0);
  const remaining = Math.max(0, TOTAL_CARDS - placedAfter);

  if (
    after.reduce(
      (total, stats, segment) => total + requiredCount(stats, conditions, segment),
      0
    ) > remaining
  ) {
    return false;
  }

  for (const condition of conditions) {
    switch (condition.type) {
      case "max-cards":
      case "exact-cards":
        if (condition.segment === decision.segment && target.count > condition.count) return false;
        break;
      case "max-sum-each":
        if (after.some((stats) => lowerSum(stats) > condition.value)) return false;
        break;
      case "sum-equals":
        if (lowerSum(after[condition.segment]!) > condition.value) return false;
        break;
      case "sum-range":
        if (lowerSum(after[condition.segment]!) > condition.max) return false;
        break;
      case "placement-order":
        if (condition.order === placedAfter && condition.segment !== decision.segment) return false;
        break;
      case "segment-colors":
        if (
          condition.segment === decision.segment &&
          (target.black > condition.black ||
            target.white > condition.white ||
            target.count > condition.black + condition.white)
        ) {
          return false;
        }
        break;
      case "max-color-cards":
        if (
          condition.segment === decision.segment &&
          (condition.color === "black" ? target.black : target.white) > condition.count
        ) {
          return false;
        }
        break;
      case "forbidden-values":
        if (
          condition.segment === decision.segment &&
          typeof card.value === "number" &&
          condition.values.includes(card.value)
        ) {
          return false;
        }
        break;
      case "all-distinct":
        if (
          condition.segment === decision.segment &&
          typeof card.value === "number" &&
          target.revealedValues.filter((value) => value === card.value).length > 1
        ) {
          return false;
        }
        break;
      case "non-decreasing":
      case "non-increasing": {
        const futureMax = remaining * MAX_VALUE;
        for (let index = 0; index + 1 < condition.segments.length; index += 1) {
          const left = after[condition.segments[index]!]!;
          const right = after[condition.segments[index + 1]!]!;
          if (condition.type === "non-decreasing" && lowerSum(left) > upperSum(right) + futureMax) {
            return false;
          }
          if (condition.type === "non-increasing" && upperSum(left) + futureMax < lowerSum(right)) {
            return false;
          }
        }
        break;
      }
      default:
        // 其余条件在中局仅凭公开信息无法严格证伪。
        break;
    }
  }
  return true;
};

export const auditPlacementReasonableness = (
  view: TurnView,
  decision: Pick<SeatPolicyDecision, "cardId" | "segment">
): boolean => {
  if (isPlacementIndependentlySafe(view, decision)) return true;

  // 局面已经无任何安全动作时，本手虽会失败但不是可避免的 Agent 失误。
  // 该“被迫”判断同样由独立审计器枚举，不调用 candidates/safePolicy。
  return view.hand.every((card) =>
    Array.from({ length: SEGMENT_COUNT }, (_, segment) =>
      !isPlacementIndependentlySafe(view, { cardId: card.id, segment })
    ).every(Boolean)
  );
};

const INFORMATION_SENSITIVE = new Set<Condition["type"]>([
  "sum-equals",
  "sum-range",
  "max-sum-each",
  "forbidden-values",
  "all-distinct",
  "closest-to-value",
  "adjacent-diff",
  "parity",
  "non-decreasing",
  "non-increasing"
]);

const informationSensitiveAt = (view: TurnView, segment: number): boolean =>
  (view.level?.conditions ?? []).some((condition) => {
    if (!INFORMATION_SENSITIVE.has(condition.type)) return false;
    if ("segment" in condition) return condition.segment === segment;
    if ("segments" in condition) return condition.segments.includes(segment);
    return condition.type === "max-sum-each";
  });

export const auditHintReasonableness = (
  view: TurnView,
  decision: SeatPolicyDecision
): boolean => {
  const markersLeft = Math.max(0, view.hintMarkers.total - view.hintMarkers.used);
  const card = view.hand.find((candidate) => candidate.id === decision.cardId);
  if (!card) return false;

  const shared = (view.placements[decision.segment] ?? []).some(
    (placed) => placed.owner !== view.seatId
  );
  const sensitive = informationSensitiveAt(view, decision.segment);
  const knownExtreme = typeof card.value === "number" && (card.value <= 2 || card.value >= 11);
  const unknownToActor = typeof card.value !== "number";
  const recommended =
    markersLeft > 0 &&
    shared &&
    sensitive &&
    (markersLeft === 1 ? knownExtreme : unknownToActor || knownExtreme);
  return decision.revealIntent === (recommended ? "yes" : "no");
};

export interface ActualCardValue {
  id: string;
  value: number;
  color: "white" | "black";
}

// 离线审计器可以读取本次 fixture 的真实牌值，用它只验证物理可能值域是否
// 覆盖真值；这些真值不会回流给 policy 或候选引擎。
export const auditBeliefPhysicalConsistency = (
  view: TurnView,
  actualCards: ReadonlyMap<string, ActualCardValue>
): boolean[] =>
  inferHiddenCardBeliefs(view).map((belief) => {
    const actual = actualCards.get(belief.cardId);
    const uniquePossible = [...new Set(belief.possibleValues)];
    const min = Math.min(...belief.possibleValues);
    const max = Math.max(...belief.possibleValues);
    return Boolean(
      actual &&
        actual.color === belief.color &&
        belief.possibleValues.length > 0 &&
        uniquePossible.length === belief.possibleValues.length &&
        belief.possibleValues.every((value) => Number.isInteger(value) && value >= 1 && value <= 12) &&
        belief.possibleValues.includes(actual.value) &&
        belief.expected >= min &&
        belief.expected <= max &&
        (belief.status !== "known" ||
          (belief.possibleValues.length === 1 &&
            belief.possibleValues[0] === actual.value &&
            belief.expected === actual.value))
    );
  });
