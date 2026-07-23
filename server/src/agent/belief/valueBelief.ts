import type { CardColor, SeatId, TurnValueBelief, TurnView } from "@take-time/shared";

// 本局信念（within-attempt）v2：物理可能值与“成功条件兼容值”分离。
// 输入只允许使用已经按座位遮蔽的 TurnView。
export const BELIEF_VERSION = "value-belief-v2";

export type HiddenCardBelief = TurnValueBelief;

const ALL_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const MIN_CARD_VALUE = 1;

interface KnownOwnCard {
  value: number;
  color: CardColor;
}

const knownOwnCards = (view: TurnView): Map<string, KnownOwnCard> => {
  const result = new Map<string, KnownOwnCard>();
  for (const action of view.memory?.ownActions ?? []) {
    if (action.kind !== "placement" || !action.payload || typeof action.payload !== "object") continue;
    const payload = action.payload as Record<string, unknown>;
    if (
      typeof payload.cardId === "string" &&
      typeof payload.knownValue === "number" &&
      (payload.knownColor === "black" || payload.knownColor === "white")
    ) {
      result.set(payload.cardId, { value: payload.knownValue, color: payload.knownColor });
    }
  }
  return result;
};

// 同色牌每个数值只有一张。这里只核销本座位确实知道的牌，不读取服务端真值。
const knownValuesByColor = (
  view: TurnView,
  ownCards: ReadonlyMap<string, KnownOwnCard>
): Record<CardColor, Set<number>> => {
  const known: Record<CardColor, Set<number>> = { black: new Set(), white: new Set() };
  for (const card of view.hand) {
    if (typeof card.value === "number" && card.color) known[card.color].add(card.value);
  }
  for (const segment of view.placements) {
    for (const card of segment) {
      if (typeof card.value === "number" && card.color) known[card.color].add(card.value);
    }
  }
  for (const card of ownCards.values()) known[card.color].add(card.value);
  return known;
};

interface SegmentBounds {
  revealedSum: number;
  hiddenCount: number;
  revealedValues: Set<number>;
  forbidden: Set<number>;
  sumCap: number | null;
}

const segmentBoundsOf = (view: TurnView): SegmentBounds[] => {
  const bounds: SegmentBounds[] = Array.from({ length: 6 }, (_, index) => {
    let revealedSum = 0;
    let hiddenCount = 0;
    const revealedValues = new Set<number>();
    for (const card of view.placements[index] ?? []) {
      if (typeof card.value === "number") {
        revealedSum += card.value;
        revealedValues.add(card.value);
      } else {
        hiddenCount += 1;
      }
    }
    return { revealedSum, hiddenCount, revealedValues, forbidden: new Set<number>(), sumCap: null };
  });

  const tightenCap = (segment: number, cap: number) => {
    const current = bounds[segment];
    if (current) current.sumCap = current.sumCap === null ? cap : Math.min(current.sumCap, cap);
  };

  for (const condition of view.level?.conditions ?? []) {
    switch (condition.type) {
      case "forbidden-values":
        for (const value of condition.values) bounds[condition.segment]?.forbidden.add(value);
        break;
      case "sum-range":
        tightenCap(condition.segment, condition.max);
        break;
      case "sum-equals":
        tightenCap(condition.segment, condition.value);
        break;
      case "max-sum-each":
        for (let segment = 0; segment < bounds.length; segment += 1) tightenCap(segment, condition.value);
        break;
      default:
        break;
    }
  }
  return bounds;
};

const strategyWeight = (view: TurnView, owner: SeatId, segment: number, value: number): number => {
  let weight = 1;
  for (const rule of view.memory?.lockedSeatStrategy?.rules ?? []) {
    if (rule.strength === "unresolved" || !rule.targetSeatIds.includes(owner)) continue;
    if (rule.targetSegments?.length && !rule.targetSegments.includes(segment)) continue;
    if (rule.type !== "value_band") continue;
    const min = Number(rule.parameters.min);
    const max = Number(rule.parameters.max);
    if (Number.isFinite(min) && Number.isFinite(max) && value >= min && value <= max) weight *= 2;
  }
  return weight;
};

const weightedExpected = (
  values: readonly number[],
  compatible: ReadonlySet<number>,
  view: TurnView,
  owner: SeatId,
  segment: number
): { expected: number; confidence: number; usedStrategy: boolean } => {
  let totalWeight = 0;
  let weightedSum = 0;
  let maxWeight = 0;
  let usedStrategy = false;
  for (const value of values) {
    const conditionWeight = compatible.size === 0 ? 1 : compatible.has(value) ? 3 : 0.5;
    const agreementWeight = strategyWeight(view, owner, segment, value);
    if (agreementWeight !== 1) usedStrategy = true;
    const weight = conditionWeight * agreementWeight;
    totalWeight += weight;
    weightedSum += value * weight;
    maxWeight = Math.max(maxWeight, weight);
  }
  return {
    expected: totalWeight > 0 ? weightedSum / totalWeight : 6.5,
    confidence: totalWeight > 0 ? maxWeight / totalWeight : 0,
    usedStrategy
  };
};

export const inferHiddenCardBeliefs = (view: TurnView): HiddenCardBelief[] => {
  const ownCards = knownOwnCards(view);
  const known = knownValuesByColor(view, ownCards);
  const bounds = segmentBoundsOf(view);
  const distinctSegments = new Set(
    (view.level?.conditions ?? []).filter((condition) => condition.type === "all-distinct").map((condition) => condition.segment)
  );
  const beliefs: HiddenCardBelief[] = [];

  view.placements.forEach((segment, segmentIndex) => {
    for (const card of segment) {
      if (typeof card.value === "number" || !card.color) continue;

      const remembered = card.owner === view.seatId ? ownCards.get(card.id) : undefined;
      const possibleValues = remembered
        ? [remembered.value]
        : ALL_VALUES.filter((value) => !known[card.color!].has(value));
      const seg = bounds[segmentIndex]!;
      const headroom =
        seg.sumCap === null ? Infinity : seg.sumCap - seg.revealedSum - (seg.hiddenCount - 1) * MIN_CARD_VALUE;
      const successCompatibleValues = possibleValues.filter(
        (value) =>
          !seg.forbidden.has(value) &&
          !(distinctSegments.has(segmentIndex) && seg.revealedValues.has(value)) &&
          value <= headroom
      );
      const compatible = new Set(successCompatibleValues);
      const weighted = remembered
        ? { expected: remembered.value, confidence: 1, usedStrategy: false }
        : weightedExpected(possibleValues, compatible, view, card.owner, segmentIndex);
      const evidence: HiddenCardBelief["evidence"] = ["deck"];
      if (remembered) evidence.push("own_memory");
      if (successCompatibleValues.length !== possibleValues.length) evidence.push("level_condition");
      if (weighted.usedStrategy) evidence.push("seat_strategy");

      beliefs.push({
        version: BELIEF_VERSION,
        cardId: card.id,
        owner: card.owner,
        segment: segmentIndex,
        color: card.color,
        status: successCompatibleValues.length === 0 ? "inconsistent" : remembered ? "known" : "estimated",
        possibleValues,
        successCompatibleValues,
        expected: weighted.expected,
        confidence: weighted.confidence,
        evidence
      });
    }
  });
  return beliefs;
};

const INFORMATION_CONDITIONS = new Set([
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

// 没有显式 hint_policy 时的保守信号策略。只在揭示能帮助队友判断一个
// 信息敏感区段时建议消耗标记；最后一个标记只留给极端已知值。
export const decideHintFromBelief = (
  view: TurnView,
  cardId: string,
  segment: number
): "yes" | "no" => {
  const markersLeft = Math.max(0, view.hintMarkers.total - view.hintMarkers.used);
  if (markersLeft === 0) return "no";
  const card = view.hand.find((candidate) => candidate.id === cardId);
  if (!card) return "no";

  const conditions = view.level?.conditions ?? [];
  const informationSensitive = conditions.some((condition) => {
    if (!INFORMATION_CONDITIONS.has(condition.type)) return false;
    if ("segment" in condition) return condition.segment === segment;
    if ("segments" in condition) return condition.segments.includes(segment);
    return condition.type === "max-sum-each";
  });
  if (!informationSensitive) return "no";

  const sharedSegment = (view.placements[segment] ?? []).some((placed) => placed.owner !== view.seatId);
  const knownExtreme = typeof card.value === "number" && (card.value <= 2 || card.value >= 11);
  const unknownToActor = typeof card.value !== "number";
  if (markersLeft === 1) return knownExtreme && sharedSegment ? "yes" : "no";
  return sharedSegment && (unknownToActor || knownExtreme) ? "yes" : "no";
};
