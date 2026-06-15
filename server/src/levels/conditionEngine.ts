import type { Condition, ConditionResult, PlacedCard, RevealResult } from "@take-time/shared";

const sum = (cards: PlacedCard[]) => cards.reduce((total, card) => total + card.value, 0);

const label = (segment: number) => `区段 ${segment + 1}`;

const evaluateOne = (
  condition: Condition,
  segmentSums: number[],
  segmentCounts: number[],
  placements: PlacedCard[][]
): ConditionResult => {
  switch (condition.type) {
    case "all-nonempty": {
      const pass = segmentCounts.every((count) => count > 0);
      return { condition, pass, message: "所有区段至少 1 张牌" };
    }
    case "min-cards": {
      const pass = segmentCounts[condition.segment] >= condition.count;
      return { condition, pass, message: `${label(condition.segment)} 至少 ${condition.count} 张` };
    }
    case "max-cards": {
      const pass = segmentCounts[condition.segment] <= condition.count;
      return { condition, pass, message: `${label(condition.segment)} 至多 ${condition.count} 张` };
    }
    case "exact-cards": {
      const pass = segmentCounts[condition.segment] === condition.count;
      return { condition, pass, message: `${label(condition.segment)} 恰好 ${condition.count} 张` };
    }
    case "sum-equals": {
      const pass = segmentSums[condition.segment] === condition.value;
      return { condition, pass, message: `${label(condition.segment)} 总和等于 ${condition.value}` };
    }
    case "sum-range": {
      const value = segmentSums[condition.segment];
      const pass = value >= condition.min && value <= condition.max;
      return { condition, pass, message: `${label(condition.segment)} 总和在 ${condition.min}-${condition.max}` };
    }
    case "parity": {
      const value = segmentSums[condition.segment];
      const pass = condition.parity === "even" ? value % 2 === 0 : Math.abs(value % 2) === 1;
      return { condition, pass, message: `${label(condition.segment)} 总和为${condition.parity === "even" ? "偶数" : "奇数"}` };
    }
    case "non-decreasing": {
      const values = condition.segments.map((segment) => segmentSums[segment]);
      const pass = values.every((value, index) => index === 0 || values[index - 1] <= value);
      return { condition, pass, message: "列出的区段总和非递减" };
    }
    case "non-increasing": {
      const values = condition.segments.map((segment) => segmentSums[segment]);
      const pass = values.every((value, index) => index === 0 || values[index - 1] >= value);
      return { condition, pass, message: "列出的区段总和非递增" };
    }
    case "adjacent-diff": {
      const pass = Math.abs(segmentSums[condition.a] - segmentSums[condition.b]) <= condition.maxDiff;
      return { condition, pass, message: `${label(condition.a)} 与 ${label(condition.b)} 总和差不超过 ${condition.maxDiff}` };
    }
    case "placement-order": {
      // 按出牌时间排序所有已放置的牌，取第 order 张（1 起）看它落在哪个区段。
      const ordered = placements
        .flatMap((cards, segment) => cards.map((card) => ({ segment, placedAt: card.placedAt })))
        .sort((a, b) => a.placedAt - b.placedAt);
      const target = ordered[condition.order - 1];
      const pass = target !== undefined && target.segment === condition.segment;
      return { condition, pass, message: `第 ${condition.order} 张打出的牌在 ${label(condition.segment)}` };
    }
    case "segment-colors": {
      const cards = placements[condition.segment];
      const black = cards.filter((card) => card.color === "black").length;
      const white = cards.filter((card) => card.color === "white").length;
      const pass = black === condition.black && white === condition.white;
      return { condition, pass, message: `${label(condition.segment)} 恰好 ${condition.black} 张黑牌、${condition.white} 张白牌` };
    }
    case "all-distinct": {
      const values = placements[condition.segment].map((card) => card.value);
      const pass = new Set(values).size === values.length;
      return { condition, pass, message: `${label(condition.segment)} 内各牌数值互不相同` };
    }
    case "max-sum-each": {
      const pass = segmentSums.every((sum) => sum <= condition.value);
      return { condition, pass, message: `所有区段总和不超过 ${condition.value}` };
    }
  }
};

export const evaluateConditions = (placements: PlacedCard[][], conditions: Condition[]): RevealResult => {
  const segmentSums = placements.map(sum);
  const segmentCounts = placements.map((cards) => cards.length);
  const results = conditions.map((condition) => evaluateOne(condition, segmentSums, segmentCounts, placements));
  return {
    pass: results.every((result) => result.pass),
    segmentSums,
    segmentCounts,
    conditions: results
  };
};
