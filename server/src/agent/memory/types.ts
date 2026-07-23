import { z } from "zod";
import type { SeatId } from "@take-time/shared";

export const seatIdSchema = z.enum(["A", "B", "C", "D"]);

// 感知记忆：不可变事件，不保存模型对事件的解释。
export const agentObservationSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  phaseVersion: z.number().int().nonnegative(),
  turnVersion: z.number().int().nonnegative(),
  type: z.enum(["chat", "placement", "hint", "card_revealed", "phase_changed", "result"]),
  visibility: z.union([z.literal("public"), z.object({ seatId: seatIdSchema })]),
  sourceSeatId: seatIdSchema.optional(),
  payload: z.unknown(),
  createdAt: z.number()
});
export type AgentObservation = z.infer<typeof agentObservationSchema>;

// 实体记忆：只承载公开、可追溯来源的事实；私人推断走 AgentBelief。
export const memoryFactSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  entityType: z.enum(["seat", "segment", "commitment", "strategy_rule"]),
  entityId: z.string(),
  attribute: z.string(),
  value: z.unknown(),
  certainty: z.enum(["explicit", "inferred", "conflicted"]),
  sourceObservationIds: z.array(z.string()),
  updatedAt: z.number()
});
export type MemoryFact = z.infer<typeof memoryFactSchema>;

export const strategyRuleSchema = z.object({
  id: z.string(),
  type: z.enum([
    "segment_assignment",
    "avoid_segment",
    "value_band",
    "color_allocation",
    "card_property_preference",
    "placement_order",
    "reserve_capacity",
    "hint_policy",
    "custom"
  ]),
  strength: z.enum(["hard_commitment", "strong_preference", "suggestion", "unresolved"]),
  targetSeatIds: z.array(seatIdSchema),
  targetSegments: z.array(z.number().int().min(0).max(5)).optional(),
  parameters: z.record(z.unknown()),
  sourceMessageIds: z.array(z.string())
});
export type StrategyRule = z.infer<typeof strategyRuleSchema>;

// 策略来源与收口结果：收口失败不得伪装成成功的空策略（2026-07-21 findings P0-2）。
// source=model：模型收口成功；public_facts_fallback：收口失败后由公开讨论事实
// 确定性派生；unavailable：收口失败且没有可派生的公开事实。
export const strategySourceSchema = z.enum(["model", "public_facts_fallback", "unavailable"]);
export type StrategySource = z.infer<typeof strategySourceSchema>;

export const strategyCompileOutcomeSchema = z.enum([
  "ok",
  "timeout",
  "cancelled",
  "illegal_output",
  "provider_error",
  "budget_exceeded"
]);
export type StrategyCompileOutcome = z.infer<typeof strategyCompileOutcomeSchema>;

export const seatStrategySchema = z.object({
  attemptId: z.string(),
  seatId: seatIdSchema,
  version: z.number().int().nonnegative(),
  status: z.enum(["draft", "locked"]),
  source: strategySourceSchema,
  compileOutcome: strategyCompileOutcomeSchema,
  rules: z.array(strategyRuleSchema),
  privatePlan: z.array(z.string())
});
export type SeatStrategy = z.infer<typeof seatStrategySchema>;

export const agentBeliefSchema = z.object({
  id: z.string(),
  attemptId: z.string(),
  seatId: seatIdSchema,
  subject: z.string(),
  hypothesis: z.string(),
  confidence: z.number().min(0).max(1),
  evidenceObservationIds: z.array(z.string()),
  updatedAt: z.number()
});
export type AgentBelief = z.infer<typeof agentBeliefSchema>;

// 同关重试摘要：只含公开信息，不含旧手牌、私人信念、私人计划或思维链。
const retryLessonSchema = z.object({
  description: z.string(),
  confidence: z.number().min(0).max(1),
  sourceIds: z.array(z.string())
});

export const retryBriefSchema = z.object({
  sourceAttemptId: z.string(),
  levelId: z.string(),
  failureReason: z.enum(["rule-unmet", "timeout", "player-left"]).optional(),
  publicStrategySummary: z.array(strategyRuleSchema),
  publicCommitments: z.array(z.string()),
  passedSegments: z.array(z.number().int().min(0).max(5)),
  failedSegments: z.array(z.number().int().min(0).max(5)),
  // lessons 保留为渲染兼容字段，内容始终是确定性发现 + 模型补充，模型不能覆盖前者。
  lessons: z.array(retryLessonSchema),
  deterministicFindings: z.array(
    z.object({ type: z.string(), description: z.string(), sourceIds: z.array(z.string()) })
  ),
  contractOutcomes: z.array(
    z.object({
      ruleId: z.string(),
      status: z.enum(["fulfilled", "impossible", "relaxed"]),
      reason: z.string()
    })
  ),
  modelLessons: z.array(retryLessonSchema),
  unresolvedIssues: z.array(z.string()),
  userCorrections: z.array(z.string())
});
export type RetryBrief = z.infer<typeof retryBriefSchema>;

export interface AttemptIdentityInput {
  campaignId: string;
  playSessionId: string;
  levelRunId: string;
  levelId: string;
  attemptId: string;
}

export interface OwnAction {
  id: string;
  attemptId: string;
  seatId: SeatId;
  kind: "placement" | "hint" | "chat";
  payload: unknown;
  appliedStrategyRuleIds: string[];
  createdAt: number;
}

export interface PendingCommitment {
  id: string;
  attemptId: string;
  seatId: SeatId;
  ruleId: string;
  description: string;
  status: "pending" | "fulfilled" | "impossible" | "relaxed";
  reason?: string;
  sourceMessageIds: string[];
}

export interface SeatPrivateMemory {
  privateObservations: AgentObservation[];
  entityBeliefs: AgentBelief[];
  currentBeliefs: AgentBelief[];
  strategyDraft: SeatStrategy | null;
  lockedSeatStrategy: SeatStrategy | null;
  ownActions: OwnAction[];
  pendingCommitments: PendingCommitment[];
}

export interface AttemptMemory {
  identity: AttemptIdentityInput;
  shared: {
    observations: AgentObservation[];
    publicEntities: MemoryFact[];
    retryBriefInput?: RetryBrief;
    publicContract?: import("../contract/types.js").PublicCoordinationContract;
  };
  privateBySeat: Partial<Record<SeatId, SeatPrivateMemory>>;
}
