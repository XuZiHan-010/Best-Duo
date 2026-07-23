import type { TurnView } from "@take-time/shared";
import { decideSafePlacement, isPlacementProvablyLosing } from "../safePolicy.js";
import { scoreCandidate, seatCoordinationRules, segmentStatsOf } from "./evaluate.js";
import {
  DEFAULT_TOP_K,
  DEFAULT_SAMPLING_MAX_CANDIDATES,
  DEFAULT_SAMPLING_MAX_MS,
  DEFAULT_SAMPLING_WORLD_COUNT,
  EVALUATOR_VERSION,
  type CandidateConfig,
  type CandidateResult,
  type ScoredCandidate
} from "./types.js";
import { applyHardStrategyRules } from "../strategy/interpreters.js";
import { evaluatePossibleWorlds, SAMPLING_VERSION, samplingActionKey } from "./sampleWorlds.js";

const SEGMENT_COUNT = 6;

// 确定性排序：分数降序 → 区段升序 → cardId 升序。相同 view + 版本必得相同结果。
const compareCandidates = (a: ScoredCandidate, b: ScoredCandidate): number =>
  b.score - a.score ||
  a.segment - b.segment ||
  (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);

const assertSafeTurnView = (view: TurnView): void => {
  const raw = view as unknown as Record<string, unknown>;
  if (
    "hands" in raw ||
    !Array.isArray(raw.hand) ||
    typeof raw.seatId !== "string" ||
    !Array.isArray(raw.placements)
  ) {
    throw new TypeError("generateCandidates 只接受经过遮蔽的 TurnView");
  }
};

// 候选引擎公开入口：只接 TurnView（安全视图），永不接 GameRoom。
// enumerate → prune(复用 safePolicy) → 硬 avoid 过滤(留至少一个) → evaluate → rank → topK。
export function generateCandidates(view: TurnView, cfg: CandidateConfig = {}): CandidateResult {
  assertSafeTurnView(view);
  const topK = cfg.topK ?? DEFAULT_TOP_K;
  const base = segmentStatsOf(view);
  const seatRules = seatCoordinationRules(view);

  // L0 枚举 + L1 严格剪枝（复用 safePolicy，不搞第二套）。
  const legal: Array<{ cardId: string; segment: number }> = [];
  for (const card of view.hand) {
    for (let segment = 0; segment < SEGMENT_COUNT; segment += 1) {
      if (isPlacementProvablyLosing(view, card.id, segment)) continue;
      legal.push({ cardId: card.id, segment });
    }
  }

  // 可执行 DSL 的硬规则逐层过滤；任一规则导致空集时只放宽该规则，不回滚其它规则。
  const hardResult = applyHardStrategyRules(view, legal);
  const survivors = hardResult.actions;
  const relaxedRuleIds = hardResult.relaxations.map((relaxation) => relaxation.ruleId);

  // 全部被剪：回落 safePolicy 的最终保底，保证 ranked 非空、兜底可用候选#1。
  if (survivors.length === 0) {
    const safe = decideSafePlacement(view);
    return {
      evaluatorVersion: EVALUATOR_VERSION,
      ranked: [{ cardId: safe.cardId, segment: safe.segment, score: 0, components: [], appliedRuleIds: [] }],
      topK: [{ cardId: safe.cardId, segment: safe.segment }],
      relaxedRuleIds,
      relaxations: hardResult.relaxations
    };
  }

  let ranked: ScoredCandidate[] = survivors
    .map(({ cardId, segment }) => {
      const card = view.hand.find((c) => c.id === cardId)!;
      const scored = scoreCandidate(view, card, segment, base, seatRules);
      return {
        cardId,
        segment,
        ...scored,
        appliedRuleIds: [...new Set([...scored.appliedRuleIds, ...hardResult.appliedRuleIds])]
      };
    })
    .sort(compareCandidates);

  let sampling: CandidateResult["sampling"];
  if (cfg.sampling?.enabled) {
    const evaluation = evaluatePossibleWorlds(view, ranked, {
      seed: cfg.sampling.seed,
      worldCount: cfg.sampling.worldCount ?? DEFAULT_SAMPLING_WORLD_COUNT,
      maxCandidates: cfg.sampling.maxCandidates ?? DEFAULT_SAMPLING_MAX_CANDIDATES,
      maxMs: cfg.sampling.maxMs ?? DEFAULT_SAMPLING_MAX_MS
    });
    ranked = ranked
      .map((candidate) => {
        const rate = evaluation.rates.get(samplingActionKey(candidate));
        if (rate === undefined) return candidate;
        const contribution = Math.round(rate * 40);
        return {
          ...candidate,
          score: candidate.score + contribution,
          components: [
            ...candidate.components,
            { source: "sampling:completion-rate", contribution, detail: rate.toFixed(3) }
          ]
        };
      })
      .sort(compareCandidates);
    sampling = {
      version: SAMPLING_VERSION,
      requestedWorlds: evaluation.requestedWorlds,
      generatedWorlds: evaluation.generatedWorlds,
      evaluatedCandidates: evaluation.evaluatedCandidates,
      evaluations: evaluation.evaluations,
      budgetExceeded: evaluation.budgetExceeded,
      elapsedMs: evaluation.elapsedMs
    };
  }

  return {
    evaluatorVersion: EVALUATOR_VERSION,
    ranked,
    topK: ranked.slice(0, topK).map(({ cardId, segment }) => ({ cardId, segment })),
    relaxedRuleIds,
    relaxations: hardResult.relaxations,
    ...(sampling ? { sampling } : {})
  };
}
