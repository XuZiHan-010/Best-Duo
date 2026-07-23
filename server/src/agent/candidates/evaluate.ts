import type { Condition, PublicHandCard, TurnView } from "@take-time/shared";
import type { ScoreComponent } from "./types.js";
import { scoreStrategyRules } from "../strategy/interpreters.js";
import { inferHiddenCardBeliefs } from "../belief/valueBelief.js";

// ── Slice 1 冻结的评分范围与权重（codex review fix 6）───────────────────────
// 支持的 Condition：segment-colors / min-color-cards / min-cards / exact-cards /
//   sum-equals / sum-range / placement-order / all-nonempty（正向评分）；
//   non-decreasing / non-increasing（软负项）。其余条件保持中性，只靠剪枝防必输，
//   绝不误加/误减分。权重是确定性常量，随 EVALUATOR_VERSION 版本化；调权重必须升版。
const W = {
  colorNeed: 10, // 往色数还缺的区段放对色牌
  countNeed: 6, // 往牌数还没放够的区段补牌
  sumProgress: 6, // 使目标区段总和更接近目标（按改善比例）
  order: 20, // 本手正好是要求的 placement-order 且落在指定区段
  allNonempty: 8, // 填一个空段（all-nonempty 存在时）
  assign: 12, // segment_assignment：落在本座位被指派区段
  avoidSoft: -14, // avoid_segment（软）：落在被避让区段
  gradient: -3 // 非递减/非递增软违规（每处）
} as const;

const SEGMENT_COUNT = 6;

interface SegStat {
  count: number;
  black: number;
  white: number;
  revealedSum: number; // 只累加已公开数值
  hiddenCount: number;
  believedHiddenSum: number;
}

const statsOf = (view: TurnView): SegStat[] => {
  const beliefs = view.memory?.valueBeliefs ?? inferHiddenCardBeliefs(view);
  const beliefByCard = new Map(beliefs.map((belief) => [belief.cardId, belief]));
  return Array.from({ length: SEGMENT_COUNT }, (_, i) => {
    const stat: SegStat = { count: 0, black: 0, white: 0, revealedSum: 0, hiddenCount: 0, believedHiddenSum: 0 };
    for (const card of view.placements[i] ?? []) {
      stat.count += 1;
      if (card.color === "black") stat.black += 1;
      else if (card.color === "white") stat.white += 1;
      if (typeof card.value === "number") stat.revealedSum += card.value;
      else {
        stat.hiddenCount += 1;
        stat.believedHiddenSum += beliefByCard.get(card.id)?.expected ?? 6.5;
      }
    }
    return stat;
  });
};

// 本座位相关的结构化约定：segment_assignment / avoid_segment，且 targetSeatIds 含本座位。
interface SeatRule {
  id: string;
  kind: "segment_assignment" | "avoid_segment";
  segments: number[];
  hard: boolean;
}

export const seatCoordinationRules = (view: TurnView): SeatRule[] => {
  const rules = view.memory?.lockedSeatStrategy?.rules ?? [];
  return rules
    .filter(
      (rule) =>
        (rule.type === "segment_assignment" || rule.type === "avoid_segment") &&
        rule.targetSeatIds.includes(view.seatId) &&
        (rule.targetSegments?.length ?? 0) > 0
    )
    .map((rule) => ({
      id: rule.id,
      kind: rule.type as SeatRule["kind"],
      segments: rule.targetSegments ?? [],
      hard: rule.strength === "hard_commitment"
    }));
};

const gradientViolations = (stats: SegStat[], conditions: Condition[]): number => {
  let violations = 0;
  for (const condition of conditions) {
    if (condition.type !== "non-decreasing" && condition.type !== "non-increasing") continue;
    const list = condition.segments;
    for (let i = 0; i + 1 < list.length; i += 1) {
      const left = stats[list[i]!];
      const right = stats[list[i + 1]!];
      if (!left || !right) continue;
      const lLow = left.revealedSum + left.believedHiddenSum;
      const rLow = right.revealedSum + right.believedHiddenSum;
      if (condition.type === "non-decreasing" && right.count > 0 && lLow > rLow) violations += 1;
      if (condition.type === "non-increasing" && left.count > 0 && lLow < rLow) violations += 1;
    }
  }
  return violations;
};

export interface CandidateScore {
  score: number;
  components: ScoreComponent[];
  appliedRuleIds: string[];
}

// 对"把 card 放进 segment"这一手打分：只用可见信息，确定性。
export const scoreCandidate = (
  view: TurnView,
  card: PublicHandCard,
  segment: number,
  base: SegStat[],
  seatRules: SeatRule[]
): CandidateScore => {
  const conditions = view.level?.conditions ?? [];
  const before = base[segment]!;
  const components: ScoreComponent[] = [];
  const appliedRuleIds: string[] = [];
  let score = 0;

  const add = (source: string, contribution: number, detail?: string) => {
    if (contribution === 0) return;
    score += contribution;
    components.push({ source, contribution, ...(detail ? { detail } : {}) });
  };

  const currentEstimatedSum = before.revealedSum + before.believedHiddenSum;
  const projectedSum = currentEstimatedSum + (typeof card.value === "number" ? card.value : 0);
  const knownValue = typeof card.value === "number";

  for (const condition of conditions) {
    switch (condition.type) {
      case "segment-colors":
        if (condition.segment === segment) {
          const needThisColor =
            (card.color === "white" && before.white < condition.white) ||
            (card.color === "black" && before.black < condition.black);
          if (needThisColor) add("condition:segment-colors", W.colorNeed, `S${segment + 1}`);
          if (before.count < condition.black + condition.white) add("condition:segment-colors:count", W.countNeed);
        }
        break;
      case "min-color-cards":
        if (condition.segment === segment && card.color === condition.color) {
          const have = condition.color === "black" ? before.black : before.white;
          if (have < condition.count) add("condition:min-color-cards", W.colorNeed);
        }
        break;
      case "min-cards":
      case "exact-cards":
        if (condition.segment === segment && before.count < condition.count) {
          add(`condition:${condition.type}`, W.countNeed);
        }
        break;
      case "sum-equals":
        if (condition.segment === segment && knownValue) {
          const improve =
            Math.abs(currentEstimatedSum - condition.value) - Math.abs(projectedSum - condition.value);
          if (improve > 0) add("condition:sum-equals", Math.min(W.sumProgress, improve));
        }
        break;
      case "sum-range":
        if (condition.segment === segment && knownValue) {
          const target = (condition.min + condition.max) / 2;
          const improve = Math.abs(currentEstimatedSum - target) - Math.abs(projectedSum - target);
          if (improve > 0) add("condition:sum-range", Math.min(W.sumProgress, improve));
        }
        break;
      case "placement-order": {
        const playOrder = base.reduce((total, stat) => total + stat.count, 0) + 1;
        if (condition.order === playOrder && condition.segment === segment) add("condition:placement-order", W.order);
        break;
      }
      case "all-nonempty":
        if (before.count === 0) add("condition:all-nonempty", W.allNonempty, `S${segment + 1}`);
        break;
      default:
        // parity / closest-to-value / adjacent-diff / forbidden-values / all-distinct /
        // has-duplicate-value / max-cards / max-color-cards / max-sum-each / non-*：Slice 1 中性。
        break;
    }
  }

  for (const rule of seatRules) {
    if (!rule.segments.includes(segment)) continue;
    if (rule.kind === "segment_assignment") {
      add("assignment", W.assign, `S${segment + 1}`);
      appliedRuleIds.push(rule.id);
    } else if (rule.kind === "avoid_segment") {
      // 硬 avoid 在 index 层过滤（存在其它候选时）；这里对软 avoid 记负分。
      if (!rule.hard) {
        add("avoid_segment", W.avoidSoft, `S${segment + 1}`);
        appliedRuleIds.push(rule.id);
      }
    }
  }

  for (const component of scoreStrategyRules(view, card, segment)) {
    // Slice 1 的两类规则仍由上面的冻结权重处理，避免重复计分。
    if (component.source === "assignment" || component.source === "avoid_segment") continue;
    add(`strategy:${component.source}`, component.contribution, component.detail);
    appliedRuleIds.push(component.ruleId);
  }

  // 软梯度：落子后的非递减/非递增违规惩罚（每处）。
  const after = base.map((stat, i) =>
    i === segment
      ? {
          ...stat,
          count: stat.count + 1,
          revealedSum: stat.revealedSum + (knownValue ? card.value! : 0),
          hiddenCount: stat.hiddenCount + (knownValue ? 0 : 1),
          believedHiddenSum: stat.believedHiddenSum + (knownValue ? 0 : 6.5)
        }
      : stat
  );
  const violations = gradientViolations(after, conditions);
  if (violations > 0) add("gradient", W.gradient * violations);

  return { score, components, appliedRuleIds };
};

export const segmentStatsOf = statsOf;
