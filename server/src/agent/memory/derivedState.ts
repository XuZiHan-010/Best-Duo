import type { Condition, TurnMemoryContext, TurnView } from "@take-time/shared";

export type DerivedConditionStatus = "satisfied" | "still_possible" | "impossible";

const conditionStatus = (
  condition: Condition,
  view: TurnView
): { status: DerivedConditionStatus; reason: string } => {
  const stats = view.segmentKnowledge ?? [];
  const segment = "segment" in condition ? condition.segment : undefined;
  const stat = segment === undefined ? undefined : stats[segment];
  switch (condition.type) {
    case "max-cards":
      return stat && stat.count > condition.count
        ? { status: "impossible", reason: "公开牌数已超过上限" }
        : { status: "still_possible", reason: "公开牌数仍在上限内" };
    case "exact-cards":
      return stat && stat.count > condition.count
        ? { status: "impossible", reason: "公开牌数已超过精确数量" }
        : { status: "still_possible", reason: "仍可达到精确数量" };
    case "sum-equals":
      return stat && stat.sumLowerBound > condition.value
        ? { status: "impossible", reason: "公开保守下界已超过目标和" }
        : { status: "still_possible", reason: "公开区间仍可能达到目标和" };
    case "sum-range":
      return stat && stat.sumLowerBound > condition.max
        ? { status: "impossible", reason: "公开保守下界已超过和上限" }
        : { status: "still_possible", reason: "公开区间仍与目标范围相容" };
    case "segment-colors":
      return stat && (stat.blackCount > condition.black || stat.whiteCount > condition.white)
        ? { status: "impossible", reason: "公开颜色数量已超过要求" }
        : { status: "still_possible", reason: "公开颜色数量仍可满足" };
    case "max-color-cards": {
      const count = condition.color === "black" ? stat?.blackCount : stat?.whiteCount;
      return count !== undefined && count > condition.count
        ? { status: "impossible", reason: "公开颜色数量已超过上限" }
        : { status: "still_possible", reason: "公开颜色数量仍在上限内" };
    }
    case "forbidden-values": {
      const cards = view.placements[condition.segment] ?? [];
      return cards.some((card) => typeof card.value === "number" && condition.values.includes(card.value))
        ? { status: "impossible", reason: "已公开禁用数值" }
        : { status: "still_possible", reason: "尚未公开禁用数值" };
    }
    case "max-sum-each":
      return stats.some((candidate) => candidate.sumLowerBound > condition.value)
        ? { status: "impossible", reason: "至少一个区段的公开保守下界已超上限" }
        : { status: "still_possible", reason: "所有公开下界仍在上限内" };
    default:
      return { status: "still_possible", reason: "当前公开信息不足以确定终态" };
  }
};

export const deriveTurnState = (view: TurnView): NonNullable<TurnMemoryContext["derivedState"]> => ({
  conditions: (view.level?.conditions ?? []).map((condition, index) => ({ index, ...conditionStatus(condition, view) })),
  commitments: (view.memory?.pendingCommitments ?? []).map((commitment) => ({
    ruleId: commitment.ruleId,
    status: commitment.status,
    ...(commitment.reason ? { reason: commitment.reason } : {})
  }))
});
