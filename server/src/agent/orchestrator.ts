import { z } from "zod";
import type { DiscussionView, TurnView } from "@take-time/shared";
import { BudgetExceededError } from "./budget.js";
import { modelAbortReason } from "./modelAbort.js";
import type { ModelClient, ModelTask } from "./modelClient.js";
import { systemPromptFor } from "./prompts.js";
import { maxOutputTokensFor } from "./providerConfig.js";
import { ProviderRequestError } from "./providers.js";
import { agentTelemetry, type AgentTelemetry, type ModelCallOutcome } from "./telemetry.js";
import { isSafeDiscussionModelMessage } from "./discussionGuard.js";
import { decideSafePlacement } from "./safePolicy.js";
import type { CandidateAction } from "./candidates/types.js";
import { publicRuleDraftSchema } from "./strategy/ruleSchemas.js";

// discussion 输出若要引用“本次即将发布的 Agent 发言”，使用该保留值；
// 服务端生成真实消息 ID 后再做可信映射。
export const CURRENT_DISCUSSION_MESSAGE_SOURCE = "__current_discussion_message__";

export const turnDecisionSchema = z.object({
  cardId: z.string(),
  segment: z.number().int().min(0).max(5),
  revealIntent: z.enum(["yes", "no"]),
  appliedStrategyRuleIds: z.array(z.string()).default([]),
  relaxedStrategyRuleIds: z.array(z.string()).default([])
});

// 超时、Provider 错误、预算超限、非法输出走同一降级状态机，
// 仅在 fallback reason 上区分原因（M9.2 第 11 条）。
export type FallbackReason = "illegal_output" | "provider_error" | "timeout" | "budget_exceeded";

export interface TurnDecision extends z.infer<typeof turnDecisionSchema> {
  source: "model" | "fallback";
  fallbackReason?: FallbackReason;
}

// 讨论发言顺带产出实体候选（同一次模型调用），来源引用公开聊天消息 id，
// 由服务端映射到 observation id 并校验后写入共享实体记忆。
const discussionEntityCandidateSchema = z.object({
  entityType: z.enum(["seat", "segment", "commitment", "strategy_rule"]),
  entityId: z.string().min(1),
  attribute: z.string().min(1),
  value: z.unknown(),
  certainty: z.enum(["explicit", "inferred"]),
  sourceMessageIds: z.array(z.string()).min(1).max(50)
});

export type DiscussionEntityCandidate = z.infer<typeof discussionEntityCandidateSchema>;

export interface DiscussionSpeakDecision {
  action: "speak";
  replyToMessageId: string;
  message: string;
  entities: DiscussionEntityCandidate[];
}

export interface DiscussionWaitDecision {
  action: "wait";
  reason: "no_substantive_input" | "nothing_new" | "let_others_answer";
}

export interface DiscussionSuggestEndDecision {
  action: "suggest_end";
  replyToMessageId: string;
  message: string;
  entities: DiscussionEntityCandidate[];
}

// 服务端不再做 on-topic 正则分类，外部话题由模型自行判定并返回该 action；
// runtime 据此推进该座位的退避阶梯（见 discussionGuard.recordModelVerdict）。
export interface DiscussionDeclineDecision {
  action: "decline_off_topic";
  replyToMessageId: string;
  message: string;
}

export type DiscussionDecision =
  | DiscussionSpeakDecision
  | DiscussionWaitDecision
  | DiscussionSuggestEndDecision
  | DiscussionDeclineDecision;

const discussionSpeakOutputSchema = z.object({
  action: z.literal("speak"),
  replyToMessageId: z.string().min(1),
  message: z.string().trim().min(1).max(240),
  entities: z.array(discussionEntityCandidateSchema).default([])
});

const discussionWaitOutputSchema = z.object({
  action: z.literal("wait"),
  reason: z.enum(["no_substantive_input", "nothing_new", "let_others_answer"])
});

const discussionSuggestEndOutputSchema = z.object({
  action: z.literal("suggest_end"),
  replyToMessageId: z.string().min(1),
  message: z.string().trim().min(1).max(240),
  entities: z.array(discussionEntityCandidateSchema).default([])
});

const discussionDeclineOutputSchema = z.object({
  action: z.literal("decline_off_topic"),
  replyToMessageId: z.string().min(1),
  message: z.string().trim().min(1).max(60)
});

const discussionOutputSchema = z.discriminatedUnion("action", [
  discussionSpeakOutputSchema,
  discussionWaitOutputSchema,
  discussionSuggestEndOutputSchema,
  discussionDeclineOutputSchema
]);

// L3 兜底：规则安全策略。M9.3 落地后会在此之前插入 L2 候选评分第一名。
// revealIntent 固定为 no——提示标记是全队共享的稀缺资源，
// 降级中的 Agent 无法可靠推理，不应替队伍消耗它。
const safeTurnDecision = (view: TurnView, fallbackReason: FallbackReason): TurnDecision => {
  const placement = decideSafePlacement(view);
  return {
    cardId: placement.cardId,
    segment: placement.segment,
    revealIntent: "no",
    appliedStrategyRuleIds: [],
    relaxedStrategyRuleIds: [],
    source: "fallback",
    fallbackReason
  };
};

// 只有「快速失败且信号仍有效」的瞬时故障值得重试。
// timeout 不重试：deadline 已经耗尽，signal 也已 abort，重试必然立刻再失败。
// budget_exceeded 不重试：预算已用尽，重试必然再抛同一个错。
// illegal_output 不重试：模型刚证明它不理解输出格式，重试只是再烧一次 token。
const isRetryableFallback = (reason: FallbackReason): boolean => reason === "provider_error";

const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

// 错误分类：预算超限 / 主动 Abort（deadline 或取消）/ 其他 Provider 错误。
export const classifyModelError = (
  error: unknown,
  signal?: AbortSignal
): Exclude<ModelCallOutcome, "ok" | "illegal_output"> => {
  if (error instanceof BudgetExceededError) return "budget_exceeded";
  const abortReason = modelAbortReason(signal);
  if (abortReason) return abortReason === "deadline" ? "timeout" : "cancelled";
  return "provider_error";
};

export class ModelRequestCancelledError extends Error {
  constructor() {
    super("模型请求已因状态变化取消");
    this.name = "ModelRequestCancelledError";
  }
}

export interface DecideOptions {
  signal?: AbortSignal;
  candidates?: {
    evaluatorVersion: string;
    topK: CandidateAction[];
  };
}

interface OrchestratorDeps {
  modelClient: ModelClient;
  telemetry?: AgentTelemetry;
}

// 视图 → 模型调用 → schema 校验 → 合法性检查 → 统一 fallback。
export class AgentOrchestrator {
  private readonly modelClient: ModelClient;
  private readonly telemetry: AgentTelemetry;

  constructor(deps: OrchestratorDeps) {
    this.modelClient = deps.modelClient;
    this.telemetry = deps.telemetry ?? agentTelemetry;
  }

  private recordCall(
    task: ModelTask,
    view: {
      seatId: string;
      attemptId: string;
      phaseVersion?: number;
      turnVersion?: number;
      level?: { id: string } | null;
      seats?: unknown[];
    },
    outcome: ModelCallOutcome,
    response?: {
      latencyMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      provider?: string;
      model?: string;
    }
  ) {
    this.telemetry.recordModelCall({
      task,
      seatId: view.seatId,
      attemptId: view.attemptId,
      phaseVersion: view.phaseVersion,
      turnVersion: view.turnVersion,
      levelId: view.level?.id,
      playerCount: view.seats?.length,
      outcome,
      providerLatencyMs: response?.latencyMs,
      tokensIn: response?.tokensIn,
      tokensOut: response?.tokensOut,
      provider: response?.provider,
      model: response?.model
    });
  }

  private errorMetadata(error: unknown) {
    return error instanceof ProviderRequestError
      ? { latencyMs: error.latencyMs, provider: error.provider, model: error.model }
      : undefined;
  }

  // 单次模型尝试：要么产出合法决策，要么给出失败原因；不在这里做兜底。
  private async attemptModelTurn(
    view: TurnView,
    options: DecideOptions
  ): Promise<{ ok: true; decision: TurnDecision } | { ok: false; reason: FallbackReason | "cancelled" }> {
    let content: string;
    let response: { latencyMs?: number; tokensIn?: number; tokensOut?: number };
    try {
      const result = await this.modelClient.complete({
        task: "turn",
        system: systemPromptFor("turn"),
        prompt: JSON.stringify(
          options.candidates
            ? {
                ...view,
                candidateSelection: options.candidates
              }
            : view
        ),
        signal: options.signal,
        attemptId: view.attemptId,
        maxOutputTokens: maxOutputTokensFor("turn")
      });
      content = result.content;
      response = result;
    } catch (error) {
      const reason = classifyModelError(error, options.signal);
      this.recordCall("turn", view, reason, this.errorMetadata(error));
      return { ok: false, reason };
    }

    const parsed = turnDecisionSchema.safeParse(parseJson(content));
    if (!parsed.success) {
      this.recordCall("turn", view, "illegal_output", response);
      return { ok: false, reason: "illegal_output" };
    }

    const decision = parsed.data;
    const ownsCard = view.hand.some((card) => card.id === decision.cardId);
    const isAllowedCandidate =
      !options.candidates ||
      options.candidates.topK.some(
        (candidate) => candidate.cardId === decision.cardId && candidate.segment === decision.segment
      );
    const availableRuleIds = new Set(view.memory?.lockedSeatStrategy?.rules.map((rule) => rule.id) ?? []);
    const referencesUnknownRule = [...decision.appliedStrategyRuleIds, ...decision.relaxedStrategyRuleIds].some(
      (id) => !availableRuleIds.has(id)
    );
    const overlapsRuleDisposition = decision.appliedStrategyRuleIds.some((id) =>
      decision.relaxedStrategyRuleIds.includes(id)
    );
    if (!ownsCard || !isAllowedCandidate || referencesUnknownRule || overlapsRuleDisposition) {
      this.recordCall("turn", view, "illegal_output", response);
      return { ok: false, reason: "illegal_output" };
    }

    this.recordCall("turn", view, "ok", response);
    return { ok: true, decision: { ...decision, source: "model" } };
  }

  // 降级阶梯：L0 模型 → L1 瞬时故障重试一次 → L3 规则安全策略。
  // （L2 候选评分器在 M9.3 落地后插入 L1 与 L3 之间。）
  async decideTurn(view: TurnView, options: DecideOptions = {}): Promise<TurnDecision> {
    const first = await this.attemptModelTurn(view, options);
    if (first.ok) return first.decision;
    if (first.reason === "cancelled") throw new ModelRequestCancelledError();

    // L1：只有信号仍有效时才值得重试，否则重试会立刻再次失败。
    if (isRetryableFallback(first.reason) && !options.signal?.aborted) {
      const retry = await this.attemptModelTurn(view, options);
      if (retry.ok) return retry.decision;
      if (retry.reason === "cancelled") throw new ModelRequestCancelledError();
      return safeTurnDecision(view, retry.reason);
    }

    return safeTurnDecision(view, first.reason);
  }

  async decideDiscussion(view: DiscussionView, options: DecideOptions = {}): Promise<DiscussionDecision | null> {
    const focusMessage = [...view.chat].reverse().find((message) => message.kind === "human") ?? null;
    let content: string;
    let response: { latencyMs?: number; tokensIn?: number; tokensOut?: number };
    try {
      const result = await this.modelClient.complete({
        task: "discussion",
        system: systemPromptFor("discussion"),
        prompt: JSON.stringify({
          kind: "discussion",
          focusMessage,
          entitySourceContract: {
            existingMessageIds: view.chat.map((message) => message.id),
            currentMessageSourceId: CURRENT_DISCUSSION_MESSAGE_SOURCE
          },
          view
        }),
        signal: options.signal,
        attemptId: view.attemptId,
        maxOutputTokens: maxOutputTokensFor("discussion")
      });
      content = result.content;
      response = result;
    } catch (error) {
      this.recordCall(
        "discussion",
        view,
        classifyModelError(error, options.signal),
        this.errorMetadata(error)
      );
      return null;
    }

    const parsed = discussionOutputSchema.safeParse(parseJson(content));
    if (!parsed.success) {
      this.recordCall("discussion", view, "illegal_output", response);
      return null;
    }
    if (parsed.data.action === "wait") {
      this.recordCall("discussion", view, "ok", response);
      return parsed.data;
    }
    if (!focusMessage || parsed.data.replyToMessageId !== focusMessage.id) {
      this.recordCall("discussion", view, "illegal_output", response);
      return null;
    }
    if (!isSafeDiscussionModelMessage(parsed.data.message)) {
      this.recordCall("discussion", view, "illegal_output", response);
      return null;
    }
    if (
      parsed.data.action === "suggest_end" &&
      (!parsed.data.message.includes("策略摘要") ||
        !parsed.data.entities.some(
          (entity) =>
            entity.entityType === "strategy_rule" &&
            (entity.attribute === "proposed_rule" || entity.attribute === "confirmed_rule") &&
            entity.sourceMessageIds.includes(CURRENT_DISCUSSION_MESSAGE_SOURCE) &&
            publicRuleDraftSchema.safeParse(entity.value).success
        ))
    ) {
      this.recordCall("discussion", view, "illegal_output", response);
      return null;
    }
    this.recordCall("discussion", view, "ok", response);
    return parsed.data;
  }

  async generateRetryLessons(
    input: {
      seatId: string;
      attemptId: string;
      phaseVersion: number;
      turnVersion: number;
      level: { id: string } | null;
      seats: unknown[];
      publicBrief: unknown;
      publicObservationIds: string[];
    },
    options: DecideOptions = {}
  ): Promise<Array<{ description: string; confidence: number; sourceIds: string[] }> | null> {
    const lessonSchema = z.object({
      lessons: z
        .array(
          z.object({
            description: z.string().trim().min(1).max(500),
            confidence: z.number().min(0).max(1),
            sourceIds: z.array(z.string()).max(50)
          })
        )
        .max(20)
        .default([])
    });
    let response: Awaited<ReturnType<ModelClient["complete"]>>;
    try {
      response = await this.modelClient.complete({
        task: "retry_brief",
        system: systemPromptFor("retry_brief"),
        prompt: JSON.stringify({ publicBrief: input.publicBrief, publicObservationIds: input.publicObservationIds }),
        signal: options.signal,
        attemptId: input.attemptId,
        maxOutputTokens: maxOutputTokensFor("retry_brief")
      });
    } catch (error) {
      this.recordCall("retry_brief", input, classifyModelError(error, options.signal), this.errorMetadata(error));
      return null;
    }
    const parsed = lessonSchema.safeParse(parseJson(response.content));
    if (!parsed.success) {
      this.recordCall("retry_brief", input, "illegal_output", response);
      return null;
    }
    const allowedSources = new Set(input.publicObservationIds);
    const lessons = parsed.data.lessons.map((lesson) => ({
      ...lesson,
      sourceIds: lesson.sourceIds.filter((id) => allowedSources.has(id))
    }));
    this.recordCall("retry_brief", input, "ok", response);
    return lessons;
  }
}
