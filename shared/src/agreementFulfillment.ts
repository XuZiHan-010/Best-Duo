import type { Condition, RevealResult } from "./level.js";
import type { PublicAgentStrategyRule, PublicPlacedCard } from "./state.js";

// 约定达标复盘：把一条 SeatStrategy 规则（协作约定）对照终局牌面 + 揭示条件结果，
// 得出「该约定针对的区段是否达标」。纯函数、无副作用、只依赖 shared 类型。
//
// 口径（诚实）：这是「目标区段最终有没有达标」，不是「AI 有没有守约」——custom
// 规则的自由文本语义无法机器校验，只能用确定性可拿到的终局牌面 + 条件结果逼近。
// shared 只返回结构化 Condition，文案由 client 的 conditionToText 渲染。

export interface SegmentComposition {
  count: number;
  black: number;
  white: number;
  sum: number; // 揭示后为真实总和
}

export interface AgreementRequirement {
  condition: Condition;
  pass: boolean;
}

export interface AgreementSegmentStatus {
  segment: number; // 0-based
  composition: SegmentComposition;
  requirements: AgreementRequirement[]; // 该区段专属条件
  met: boolean; // 所有专属条件通过；无专属条件视为 true
  spanningIssues: Condition[]; // 跨区段规则涉及本段且失败的条件；不参与 met
}

export type AgreementVerdict = "met" | "unmet" | "no-target";

export interface AgreementFulfillment {
  verdict: AgreementVerdict;
  segments: AgreementSegmentStatus[]; // no-target 时为空
}

// 跨区段条件是否涉及某段：非递减/非递增看 segments，相邻差看 a/b。
const conditionSpansSegment = (condition: Condition, segment: number): boolean => {
  if (condition.type === "non-decreasing" || condition.type === "non-increasing") {
    return condition.segments.includes(segment);
  }
  if (condition.type === "adjacent-diff") {
    return condition.a === segment || condition.b === segment;
  }
  return false;
};

const compositionOf = (cards: PublicPlacedCard[]): SegmentComposition =>
  cards.reduce<SegmentComposition>(
    (acc, card) => ({
      count: acc.count + 1,
      black: acc.black + (card.color === "black" ? 1 : 0),
      white: acc.white + (card.color === "white" ? 1 : 0),
      sum: acc.sum + (typeof card.value === "number" ? card.value : 0)
    }),
    { count: 0, black: 0, white: 0, sum: 0 }
  );

export function evaluateAgreementFulfillment(
  rule: Pick<PublicAgentStrategyRule, "targetSegments">,
  placements: PublicPlacedCard[][],
  revealResult: RevealResult
): AgreementFulfillment {
  const targets = rule.targetSegments ?? [];
  if (targets.length === 0) return { verdict: "no-target", segments: [] };

  const segments: AgreementSegmentStatus[] = targets.map((segment) => {
    const composition = compositionOf(placements[segment] ?? []);
    const requirements: AgreementRequirement[] = [];
    const spanningIssues: Condition[] = [];
    for (const { condition, pass } of revealResult.conditions) {
      if ("segment" in condition && condition.segment === segment) {
        requirements.push({ condition, pass });
      } else if (!pass && conditionSpansSegment(condition, segment)) {
        spanningIssues.push(condition);
      }
    }
    // 无专属条件视为达标（仅受全局规则约束）；跨区段问题只记录、不翻转 met。
    const met = requirements.every((requirement) => requirement.pass);
    return { segment, composition, requirements, met, spanningIssues };
  });

  const verdict: AgreementVerdict = segments.every((status) => status.met) ? "met" : "unmet";
  return { verdict, segments };
}
