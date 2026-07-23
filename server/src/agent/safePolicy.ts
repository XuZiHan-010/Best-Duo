import type { Condition, PublicHandCard, PublicPlacedCard, TurnView } from "@take-time/shared";

// L3 规则安全策略：模型不可用时的确定性兜底。
//
// 只读 TurnView 中本座位可见的信息，绝不接收 GameRoom，也绝不使用 game/solver.ts 的
// 全信息求解器——那会让 Agent 通过真实解间接作弊。
//
// 原则是「可证伪剪枝」：只剪掉从可见信息可**严格证明**必输的动作；证不出来就保留。
// 未揭示的桌面暗牌只知道颜色，2 人局本人的盲牌连颜色和数值都不知道，
// 这类未知一律按区间处理，不得反推真实值。

export interface SafePlacement {
  cardId: string;
  segment: number;
}

const SEGMENT_COUNT = 6;
const TOTAL_CARDS = 12;
const MIN_CARD_VALUE = 1;
const MAX_CARD_VALUE = 12;

interface SegmentStats {
  count: number;
  revealedSum: number;
  hiddenCount: number;
  blackCount: number;
  whiteCount: number;
  // 未知颜色的牌只可能出现在本座位刚放下的盲牌上；桌面暗牌颜色始终公开。
  unknownColorCount: number;
  revealedValues: number[];
}

const emptyStats = (): SegmentStats => ({
  count: 0,
  revealedSum: 0,
  hiddenCount: 0,
  blackCount: 0,
  whiteCount: 0,
  unknownColorCount: 0,
  revealedValues: []
});

const statsOf = (placements: PublicPlacedCard[][]): SegmentStats[] =>
  Array.from({ length: SEGMENT_COUNT }, (_, index) => {
    const stats = emptyStats();
    for (const card of placements[index] ?? []) {
      stats.count += 1;
      if (typeof card.value === "number") {
        stats.revealedSum += card.value;
        stats.revealedValues.push(card.value);
      } else {
        stats.hiddenCount += 1;
      }
      if (card.color === "black") stats.blackCount += 1;
      else if (card.color === "white") stats.whiteCount += 1;
      else stats.unknownColorCount += 1;
    }
    return stats;
  });

// 落子后的假想统计；未知数值/颜色不臆测，只累加到对应的未知计数。
const withCard = (stats: SegmentStats, card: PublicHandCard): SegmentStats => {
  const next: SegmentStats = { ...stats, revealedValues: [...stats.revealedValues] };
  next.count += 1;
  if (typeof card.value === "number") {
    next.revealedSum += card.value;
    next.revealedValues.push(card.value);
  } else {
    next.hiddenCount += 1;
  }
  if (card.color === "black") next.blackCount += 1;
  else if (card.color === "white") next.whiteCount += 1;
  else next.unknownColorCount += 1;
  return next;
};

const sumLowerBound = (stats: SegmentStats): number => stats.revealedSum + stats.hiddenCount * MIN_CARD_VALUE;
const sumUpperBound = (stats: SegmentStats): number => stats.revealedSum + stats.hiddenCount * MAX_CARD_VALUE;

// 某区段最少还需要补几张牌才可能满足其牌数下限。
const cardDeficit = (stats: SegmentStats, conditions: Condition[], segment: number): number => {
  let required = stats.count > 0 ? 0 : 1; // all-nonempty 由 loadLevels 统一注入，这里按“至少 1 张”保底
  for (const condition of conditions) {
    if (condition.type === "min-cards" && condition.segment === segment) {
      required = Math.max(required, condition.count);
    }
    if (condition.type === "exact-cards" && condition.segment === segment) {
      required = Math.max(required, condition.count);
    }
    if (condition.type === "segment-colors" && condition.segment === segment) {
      required = Math.max(required, condition.black + condition.white);
    }
    if (condition.type === "min-color-cards" && condition.segment === segment) {
      required = Math.max(required, condition.count);
    }
  }
  return Math.max(0, required - stats.count);
};

// 是否能严格证明这一手必输。证不出来一律返回 false（保留候选）。
const isProvablyLosing = (
  next: SegmentStats[],
  conditions: Condition[],
  segment: number,
  card: PublicHandCard,
  playOrder: number,
  remainingAfterMove: number
): boolean => {
  const target = next[segment]!;

  // 牌数下限的总需求超过剩余牌数 → 不可能全部满足。
  let totalDeficit = 0;
  for (let index = 0; index < SEGMENT_COUNT; index += 1) {
    totalDeficit += cardDeficit(next[index]!, conditions, index);
  }
  if (totalDeficit > remainingAfterMove) return true;

  for (const condition of conditions) {
    switch (condition.type) {
      case "max-cards":
        if (condition.segment === segment && target.count > condition.count) return true;
        break;
      case "exact-cards":
        if (condition.segment === segment && target.count > condition.count) return true;
        break;
      case "max-sum-each":
        // 每段总和上限：用下界判定，下界都超了就无可挽回。
        for (const stats of next) if (sumLowerBound(stats) > condition.value) return true;
        break;
      case "sum-equals":
        if (sumLowerBound(next[condition.segment]!) > condition.value) return true;
        break;
      case "sum-range":
        if (sumLowerBound(next[condition.segment]!) > condition.max) return true;
        break;
      case "non-decreasing": {
        // 严格判定必须计入未来仍可入段的牌：右段之后还能收到至多
        // remainingAfterMove 张牌抬高上界，只有连这些都补不回来才算必输。
        // 空段/早期局面因此几乎不可证伪——这是刻意的：护栏只拦真死局，
        // 梯度好坏交给排序层的软违规惩罚（softGradientViolations）。
        const futureMax = remainingAfterMove * MAX_CARD_VALUE;
        const list = condition.segments;
        for (let i = 0; i + 1 < list.length; i += 1) {
          const left = next[list[i]!];
          const right = next[list[i + 1]!];
          if (!left || !right) continue;
          // 左段下界高过右段“上界 + 未来可补上界” → 非递减不可能成立。
          if (sumLowerBound(left) > sumUpperBound(right) + futureMax) return true;
        }
        break;
      }
      case "non-increasing": {
        const futureMax = remainingAfterMove * MAX_CARD_VALUE;
        const list = condition.segments;
        for (let i = 0; i + 1 < list.length; i += 1) {
          const left = next[list[i]!];
          const right = next[list[i + 1]!];
          if (!left || !right) continue;
          if (sumUpperBound(left) + futureMax < sumLowerBound(right)) return true;
        }
        break;
      }
      case "placement-order":
        // 本手正好是第 order 张，却没落在指定区段。
        if (condition.order === playOrder && condition.segment !== segment) return true;
        break;
      case "segment-colors":
        if (condition.segment === segment) {
          if (target.blackCount > condition.black || target.whiteCount > condition.white) return true;
          if (target.count > condition.black + condition.white) return true;
        }
        break;
      case "max-color-cards":
        if (condition.segment === segment) {
          const used = condition.color === "black" ? target.blackCount : target.whiteCount;
          if (used > condition.count) return true;
        }
        break;
      case "forbidden-values":
        // 只有本人可见的牌才知道数值；盲牌不臆测。
        if (condition.segment === segment && typeof card.value === "number") {
          if (condition.values.includes(card.value)) return true;
        }
        break;
      case "all-distinct":
        if (condition.segment === segment && typeof card.value === "number") {
          const duplicates = target.revealedValues.filter((value) => value === card.value).length;
          if (duplicates > 1) return true;
        }
        break;
      default:
        // parity / closest-to-value / adjacent-diff / min-cards / min-color-cards /
        // has-duplicate-value / all-nonempty：在中途无法严格证伪，保留候选。
        break;
    }
  }
  return false;
};

interface Ranked {
  cardId: string;
  segment: number;
  emptyUrgency: number;
  softViolations: number;
  gradientPenalty: number;
  cardValueRank: number;
}

// 排序完全确定性：同一视图重复调用结果一致，不使用任何随机源。
const compareRanked = (left: Ranked, right: Ranked): number =>
  right.emptyUrgency - left.emptyUrgency ||
  left.softViolations - right.softViolations ||
  left.gradientPenalty - right.gradientPenalty ||
  left.segment - right.segment ||
  left.cardValueRank - right.cardValueRank ||
  (left.cardId < right.cardId ? -1 : left.cardId > right.cardId ? 1 : 0);

// “现值违反”软惩罚：仅按当前牌面判断左段是否已压过非空右段。
// 这不是必输证明（未来牌可能翻案），因此只作排序降权、不做剪枝——
// 剪枝的严格版在 isProvablyLosing 里计入 futureMax。
const softGradientViolations = (next: SegmentStats[], conditions: Condition[]): number => {
  let violations = 0;
  for (const condition of conditions) {
    if (condition.type !== "non-decreasing" && condition.type !== "non-increasing") continue;
    const list = condition.segments;
    for (let i = 0; i + 1 < list.length; i += 1) {
      const left = next[list[i]!];
      const right = next[list[i + 1]!];
      if (!left || !right) continue;
      if (condition.type === "non-decreasing") {
        if (right.count > 0 && sumLowerBound(left) > sumUpperBound(right)) violations += 1;
      } else {
        if (left.count > 0 && sumUpperBound(left) < sumLowerBound(right)) violations += 1;
      }
    }
  }
  return violations;
};

// 梯度契合度：区段索引越大越该放大牌。盲牌按中位值参与排序，不影响剪枝。
const gradientPenaltyOf = (segment: number, card: PublicHandCard): number => {
  const value = typeof card.value === "number" ? card.value : (MIN_CARD_VALUE + MAX_CARD_VALUE) / 2;
  const ideal = ((segment + 0.5) / SEGMENT_COUNT) * MAX_CARD_VALUE;
  return Math.abs(value - ideal);
};

/**
 * 模型不可用时的确定性出牌决策。
 *
 * 保证：给定任何合法局面都会返回一个动作，绝不抛错、绝不卡死回合。
 * 全部候选都被证明必输时，退回「段索引最小的合法位置」，把选择权交回给游戏本身。
 */
export const decideSafePlacement = (view: TurnView): SafePlacement => {
  const hand = view.hand;
  if (hand.length === 0) throw new Error("Agent has no card to place");

  const conditions = view.level?.conditions ?? [];
  const base = statsOf(view.placements);
  const placedTotal = base.reduce((total, stats) => total + stats.count, 0);
  const playOrder = placedTotal + 1;
  const remainingAfterMove = Math.max(0, TOTAL_CARDS - placedTotal - 1);

  const survivors: Ranked[] = [];
  for (const card of hand) {
    for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
      const next = base.map((stats, index) => (index === segment ? withCard(stats, card) : stats));
      if (isProvablyLosing(next, conditions, segment, card, playOrder, remainingAfterMove)) continue;

      // 空段紧迫度：剩余牌数刚好够填满空段时，优先补空段。
      const emptySegments = next.filter((stats) => stats.count === 0).length;
      const wasEmpty = base[segment]!.count === 0;
      survivors.push({
        cardId: card.id,
        segment,
        emptyUrgency: wasEmpty && remainingAfterMove <= emptySegments + 1 ? 1 : 0,
        softViolations: softGradientViolations(next, conditions),
        gradientPenalty: gradientPenaltyOf(segment, card),
        cardValueRank: typeof card.value === "number" ? card.value : MAX_CARD_VALUE + 1
      });
    }
  }

  if (survivors.length > 0) {
    survivors.sort(compareRanked);
    const best = survivors[0]!;
    return { cardId: best.cardId, segment: best.segment };
  }

  // 全部候选都可被证明必输：局面已经无法挽回，选一个合法位置让回合继续。
  return { cardId: hand[0]!.id, segment: 0 };
};

/**
 * 模型输出的最小安全护栏（2026-07-21 findings P0-2）：判断一手落子是否
 * 已可从本座位可见信息严格证明必输。证不出来一律返回 false（接受模型选择）。
 * 与 decideSafePlacement 共用同一套严格剪枝，绝不读取隐藏信息。
 * 非法 cardId/segment 不属于本函数职责（orchestrator schema 层已拦截），返回 false。
 */
export const isPlacementProvablyLosing = (view: TurnView, cardId: string, segment: number): boolean => {
  const card = view.hand.find((candidate) => candidate.id === cardId);
  if (!card || !Number.isInteger(segment) || segment < 0 || segment >= SEGMENT_COUNT) return false;

  const conditions = view.level?.conditions ?? [];
  const base = statsOf(view.placements);
  const placedTotal = base.reduce((total, stats) => total + stats.count, 0);
  const next = base.map((stats, index) => (index === segment ? withCard(stats, card) : stats));
  return isProvablyLosing(next, conditions, segment, card, placedTotal + 1, Math.max(0, TOTAL_CARDS - placedTotal - 1));
};
