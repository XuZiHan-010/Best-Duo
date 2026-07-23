import type { TurnView } from "@take-time/shared";
import type { AgentOrchestrator } from "../agent/orchestrator.js";
import { decideSafePlacement } from "../agent/safePolicy.js";
import { generateCandidates } from "../agent/candidates/index.js";
import { decideHintFromBelief } from "../agent/belief/valueBelief.js";

export interface SeatPolicyDecision {
  cardId: string;
  segment: number;
  revealIntent: "yes" | "no";
}

// 离线 eval 专用座位策略接口（M9.6 扩展 decideDiscussion / Replay / Heuristic / Model 实现）。
// 只消费遮蔽后的 TurnView，不允许接触 GameRoom。
export interface SeatPolicy {
  decideTurn(view: TurnView): Promise<SeatPolicyDecision>;
  decideHint(view: TurnView): Promise<"yes" | "no">;
}

// 确定性基线：第一张手牌放到牌数最少的区段，不用提示标记。
export const createScriptedSeatPolicy = (): SeatPolicy => ({
  async decideTurn(view) {
    const card = view.hand[0];
    if (!card) throw new Error("Seat has no card to place");

    const segmentLoads = view.placements.map((segment, index) => ({ index, count: segment.length }));
    segmentLoads.sort((left, right) => left.count - right.count || left.index - right.index);

    return { cardId: card.id, segment: segmentLoads[0]?.index ?? 0, revealIntent: "no" };
  },

  async decideHint() {
    return "no";
  }
});

export const createSafeSeatPolicy = (): SeatPolicy => ({
  async decideTurn(view) {
    return { ...decideSafePlacement(view), revealIntent: "no" };
  },
  async decideHint() {
    return "no";
  }
});

export const createCandidateSeatPolicy = (options: {
  samplingSeed: string;
  sampling?: boolean;
  samplingMaxMs?: number;
  samplingWorldCount?: number;
  assignedSegment?: number;
}): SeatPolicy => {
  const intents = new Map<string, "yes" | "no">();
  return {
    async decideTurn(view) {
      const effectiveView = options.assignedSegment === undefined
        ? view
        : {
            ...view,
            memory: {
              lockedSeatStrategy: {
                version: 1,
                rules: [{
                  id: `eval-assignment-${view.seatId}`,
                  type: "segment_assignment" as const,
                  strength: "hard_commitment" as const,
                  targetSeatIds: [view.seatId],
                  targetSegments: [options.assignedSegment],
                  parameters: {},
                  sourceMessageIds: ["eval-contract"]
                }],
                privatePlan: []
              },
              ownActions: [],
              currentBeliefs: [],
              pendingCommitments: []
            }
          };
      const result = generateCandidates(effectiveView, {
        sampling: {
          enabled: options.sampling ?? false,
          seed: `${options.samplingSeed}:${view.turnVersion}`,
          ...(options.samplingMaxMs !== undefined ? { maxMs: options.samplingMaxMs } : {}),
          ...(options.samplingWorldCount !== undefined ? { worldCount: options.samplingWorldCount } : {})
        }
      });
      const first = result.ranked[0];
      if (!first) throw new Error("候选引擎没有返回动作");
      const revealIntent = decideHintFromBelief(effectiveView, first.cardId, first.segment);
      intents.set(`${view.attemptId}:${first.cardId}`, revealIntent);
      return { cardId: first.cardId, segment: first.segment, revealIntent };
    },
    async decideHint(view) {
      if (!view.pendingHint) return "no";
      const key = `${view.attemptId}:${view.pendingHint.cardId}`;
      const intent = intents.get(key) ?? "no";
      intents.delete(key);
      return intent;
    }
  };
};

// 单步决策评测用的模型座位 policy（M9.2）：经 orchestrator 走完整的
// schema 校验与 fallback 链，仅消费遮蔽视图；生产入口不使用。
// M9.6 的完整 ModelSeatPolicy（含 decideDiscussion）在此基础上扩展。
export const createOrchestratorSeatPolicy = (orchestrator: AgentOrchestrator): SeatPolicy => {
  const intents = new Map<string, "yes" | "no">();
  return {
    async decideTurn(view) {
      const decision = await orchestrator.decideTurn(view);
      intents.set(`${view.attemptId}:${decision.cardId}`, decision.revealIntent);
      return { cardId: decision.cardId, segment: decision.segment, revealIntent: decision.revealIntent };
    },

    async decideHint(view) {
      if (!view.pendingHint) return "no";
      const key = `${view.attemptId}:${view.pendingHint.cardId}`;
      const intent = intents.get(key) ?? "no";
      intents.delete(key);
      return intent;
    }
  };
};
