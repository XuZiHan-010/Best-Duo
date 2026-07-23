import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DiscussionView, SeatId } from "@take-time/shared";
import { strategyRuleSchema, type StrategyCompileOutcome, type StrategyRule } from "./memory/types.js";
import type { ModelClient } from "./modelClient.js";
import { classifyModelError } from "./orchestrator.js";
import { systemPromptFor } from "./prompts.js";
import { maxOutputTokensFor } from "./providerConfig.js";
import { ProviderRequestError } from "./providers.js";
import { agentTelemetry, type AgentTelemetry } from "./telemetry.js";

// 模型提出的规则不带 id，由服务端补齐。
const proposedRuleSchema = strategyRuleSchema.omit({ id: true }).extend({
  targetSeatIds: z.array(z.enum(["A", "B", "C", "D"])).default([]),
  parameters: z.record(z.unknown()).default({}),
  sourceMessageIds: z.array(z.string()).default([])
});

export const strategyPlannerOutputSchema = z.object({
  rules: z.array(proposedRuleSchema).default([]),
  privatePlan: z.array(z.string()).default([])
});

export interface SeatStrategyProposal {
  rules: StrategyRule[];
  privatePlan: string[];
  // 收口结果：调用方据此决定是否切换到公开事实兜底策略（P0-2）。
  outcome: StrategyCompileOutcome;
}

const parseJson = (content: string): unknown => {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
};

interface PlannerDeps {
  modelClient: ModelClient;
  telemetry?: AgentTelemetry;
}

// 每个 Agent 像真人一样独立理解讨论并生成自己的策略提案；
// 讨论不足或模型失败时返回空提案，决策层退回启发式。
// Planner 本身不写 memory：提案由 runtime 校验 attempt 版本后提交，
// 避免过期模型响应污染新 attempt（ACR-01）。
export class AgentStrategyPlanner {
  private readonly modelClient: ModelClient;
  private readonly telemetry: AgentTelemetry;

  constructor(deps: PlannerDeps) {
    this.modelClient = deps.modelClient;
    this.telemetry = deps.telemetry ?? agentTelemetry;
  }

  async compileForSeat(
    seatId: SeatId,
    view: DiscussionView,
    options: { signal?: AbortSignal } = {}
  ): Promise<SeatStrategyProposal> {
    const { data: proposal, outcome } = await this.requestProposal(view, options.signal);
    const senderByMessageId = new Map(view.chat.map((message) => [message.id, message.senderSeatId]));
    const conflictedMessageIds = new Set(
      (view.publicFacts ?? [])
        .filter((fact) => fact.certainty === "conflicted")
        .flatMap((fact) => fact.sourceMessageIds)
    );
    const explicitAgreementMessageIds = new Set(
      (view.publicFacts ?? [])
        .filter(
          (fact) =>
            fact.certainty === "explicit" &&
            (fact.entityType === "commitment" || fact.entityType === "strategy_rule")
        )
        .flatMap((fact) => fact.sourceMessageIds)
    );

    const rules: StrategyRule[] = proposal.rules.map((rule) => {
      const knownSources = rule.sourceMessageIds.filter((id) => senderByMessageId.has(id));
      let strength = rule.strength;

      // custom 规则没有服务端确定性解释器，强度封顶为 suggestion；
      // 它不会进入下面的硬承诺升级校验。
      if (rule.type === "custom" && (strength === "hard_commitment" || strength === "strong_preference")) {
        strength = "suggestion";
      }

      // 硬承诺必须能追溯到当前 attempt 里非本 Agent 发送、且已被实体管线
      // 确认为 explicit 的公开承诺/策略规则。单纯引用任意聊天不能升级为硬约束。
      if (strength === "hard_commitment") {
        const hasExplicitExternalAgreement = knownSources.some(
          (id) => senderByMessageId.get(id) !== seatId && explicitAgreementMessageIds.has(id)
        );
        if (!hasExplicitExternalAgreement) strength = "unresolved";
      }

      // 引用了 conflicted 实体事实来源消息的规则一律进入 unresolved：
      // 冲突内容不得被任何强度采纳为可执行约定（ACR-02）。
      if (strength !== "unresolved" && knownSources.some((id) => conflictedMessageIds.has(id))) {
        strength = "unresolved";
      }

      return {
        ...rule,
        id: randomUUID(),
        strength,
        sourceMessageIds: knownSources
      };
    });

    return { rules, privatePlan: proposal.privatePlan, outcome };
  }

  private recordCall(
    view: DiscussionView,
    outcome: "ok" | "provider_error" | "illegal_output" | "timeout" | "budget_exceeded" | "cancelled",
    response?: {
      latencyMs?: number;
      tokensIn?: number;
      tokensOut?: number;
      provider?: string;
      model?: string;
    }
  ) {
    this.telemetry.recordModelCall({
      task: "discussion",
      seatId: view.seatId,
      attemptId: view.attemptId,
      levelId: view.level?.id,
      playerCount: view.seats.length,
      outcome,
      providerLatencyMs: response?.latencyMs,
      tokensIn: response?.tokensIn,
      tokensOut: response?.tokensOut,
      provider: response?.provider,
      model: response?.model
    });
  }

  private async requestProposal(
    view: DiscussionView,
    signal?: AbortSignal
  ): Promise<{ data: z.infer<typeof strategyPlannerOutputSchema>; outcome: StrategyCompileOutcome }> {
    try {
      const response = await this.modelClient.complete({
        task: "discussion",
        system: systemPromptFor("discussion"),
        prompt: JSON.stringify({ kind: "compile_seat_strategy", view }),
        signal,
        attemptId: view.attemptId,
        maxOutputTokens: maxOutputTokensFor("discussion"),
        // 收口是把已成型的讨论结论结构化，不需要满档推理；low 档显著压延迟。
        reasoningEffort: "low"
      });
      const parsed = strategyPlannerOutputSchema.safeParse(parseJson(response.content));
      if (parsed.success) {
        this.recordCall(view, "ok", response);
        return { data: parsed.data, outcome: "ok" };
      }
      this.recordCall(view, "illegal_output", response);
      console.warn(JSON.stringify({ event: "strategy:invalid_model_output", seatId: view.seatId }));
      return { data: { rules: [], privatePlan: [] }, outcome: "illegal_output" };
    } catch (error) {
      const metadata =
        error instanceof ProviderRequestError
          ? { latencyMs: error.latencyMs, provider: error.provider, model: error.model }
          : undefined;
      const outcome = classifyModelError(error, signal);
      this.recordCall(view, outcome, metadata);
      if (outcome !== "cancelled") {
        console.warn(
          JSON.stringify({ event: "strategy:model_call_failed", seatId: view.seatId, error: String(error) })
        );
      }
      return { data: { rules: [], privatePlan: [] }, outcome };
    }
  }
}
