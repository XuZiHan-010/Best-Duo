import type { ModelTask } from "./modelClient.js";
import { PROMPT_VERSION } from "./prompts.js";

// M9.2 验收定义的六项指标口径（M9.5 落库，这里先内存统计 + 结构化日志）：
// providerLatencyMs：单次模型网络调用延迟（model_call.providerLatencyMs）
// decisionEndToEndLatencyMs：轮到 Agent 至合法落子完成（turn_decision）
// deadlineMissRate：outcome=timeout 的模型调用 / 全部模型调用
// fallbackRate：source=fallback 的决策 / 全部决策
// cancelRate：因 phase/turn/race 变化被取消的决策 / 全部决策（不计失败）
// illegalOutputRate：outcome=illegal_output 的模型响应 / 全部模型调用
export type ModelCallOutcome =
  | "ok"
  | "provider_error"
  | "illegal_output"
  | "timeout"
  | "budget_exceeded"
  | "cancelled";

export interface ModelCallEvent {
  kind: "model_call";
  task: ModelTask;
  seatId: string;
  attemptId: string;
  phaseVersion?: number;
  turnVersion?: number;
  levelId?: string;
  playerCount?: number;
  provider?: string;
  model?: string;
  outcome: ModelCallOutcome;
  providerLatencyMs?: number;
  tokensIn?: number;
  tokensOut?: number;
  promptVersion: string;
  at: number;
}

export interface TurnDecisionEvent {
  kind: "turn_decision";
  seatId: string;
  attemptId: string;
  phaseVersion: number;
  turnVersion: number;
  levelId?: string;
  playerCount?: number;
  source: "model" | "candidate" | "fallback" | "cancelled";
  fallbackReason?: string;
  selectionSource?: "model" | "candidate_top1" | "candidate_confidence" | "candidate_fallback" | "safe_policy";
  candidateSetHash?: string;
  evaluatorVersion?: string;
  samplingVersion?: string;
  samplingWorlds?: number;
  samplingEvaluations?: number;
  samplingBudgetExceeded?: boolean;
  candidateComputeMs?: number;
  hintDecisionSource?: "model" | "default_no" | "hint_policy" | "belief_signal";
  appliedStrategyRuleIds?: string[];
  relaxedStrategyRuleIds?: string[];
  decisionEndToEndLatencyMs: number;
  at: number;
}

export type AgentTelemetryEvent = ModelCallEvent | TurnDecisionEvent;

export const percentile = (values: number[], p: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? null;
};

export class AgentTelemetry {
  private events: AgentTelemetryEvent[] = [];

  constructor(private readonly log: (line: string) => void = (line) => console.log(line)) {}

  recordModelCall(event: Omit<ModelCallEvent, "kind" | "promptVersion" | "at">) {
    const full: ModelCallEvent = { kind: "model_call", promptVersion: PROMPT_VERSION, at: Date.now(), ...event };
    this.events.push(full);
    this.log(JSON.stringify({ event: "agent:model_call", ...full }));
  }

  recordTurnDecision(event: Omit<TurnDecisionEvent, "kind" | "at">) {
    const full: TurnDecisionEvent = { kind: "turn_decision", at: Date.now(), ...event };
    this.events.push(full);
    this.log(JSON.stringify({ event: "agent:turn_decision", ...full }));
  }

  snapshot() {
    const modelCalls = this.events.filter((event): event is ModelCallEvent => event.kind === "model_call");
    const decisions = this.events.filter((event): event is TurnDecisionEvent => event.kind === "turn_decision");
    const latencies = modelCalls
      .map((event) => event.providerLatencyMs)
      .filter((value): value is number => typeof value === "number");
    const endToEnd = decisions.map((event) => event.decisionEndToEndLatencyMs);

    const countCalls = (outcome: ModelCallOutcome) => modelCalls.filter((event) => event.outcome === outcome).length;
    const rate = (count: number, total: number) => (total === 0 ? 0 : count / total);

    const summarize = (groupCalls: ModelCallEvent[], groupDecisions: TurnDecisionEvent[]) => {
      const outcomeCalls = groupCalls.filter((event) => event.outcome !== "cancelled");
      const completedDecisions = groupDecisions.filter((event) => event.source !== "cancelled");
      const groupLatencies = groupCalls
        .map((event) => event.providerLatencyMs)
        .filter((value): value is number => typeof value === "number");
      const groupEndToEnd = groupDecisions.map((event) => event.decisionEndToEndLatencyMs);
      const groupCount = (outcome: ModelCallOutcome) =>
        groupCalls.filter((event) => event.outcome === outcome).length;
      return {
        modelCallCount: groupCalls.length,
        decisionCount: groupDecisions.length,
        providerLatencyMs: {
          n: groupLatencies.length,
          p50: percentile(groupLatencies, 50),
          p95: percentile(groupLatencies, 95),
          p99: percentile(groupLatencies, 99)
        },
        decisionEndToEndLatencyMs: {
          n: groupEndToEnd.length,
          p50: percentile(groupEndToEnd, 50),
          p95: percentile(groupEndToEnd, 95),
          p99: percentile(groupEndToEnd, 99)
        },
        deadlineMissRate: rate(groupCount("timeout"), outcomeCalls.length),
        illegalOutputRate: rate(groupCount("illegal_output"), outcomeCalls.length),
        fallbackRate: rate(
          completedDecisions.filter((event) => event.source === "fallback").length,
          completedDecisions.length
        ),
        cancelRate: rate(
          groupDecisions.filter((event) => event.source === "cancelled").length,
          groupDecisions.length
        )
      };
    };

    const groupKeys = new Set(
      [...modelCalls, ...decisions]
        .filter((event) => event.levelId && event.playerCount)
        .map((event) => `${event.levelId}:${event.playerCount}`)
    );
    const groups = [...groupKeys].map((key) => {
      const [levelId, playerCountText] = key.split(":");
      const playerCount = Number(playerCountText);
      return {
        levelId: levelId!,
        playerCount,
        ...summarize(
          modelCalls.filter((event) => event.levelId === levelId && event.playerCount === playerCount),
          decisions.filter((event) => event.levelId === levelId && event.playerCount === playerCount)
        )
      };
    });

    return {
      modelCallCount: modelCalls.length,
      decisionCount: decisions.length,
      providerLatencyMs: {
        n: latencies.length,
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99)
      },
      decisionEndToEndLatencyMs: {
        n: endToEnd.length,
        p50: percentile(endToEnd, 50),
        p95: percentile(endToEnd, 95),
        p99: percentile(endToEnd, 99)
      },
      deadlineMissRate: rate(countCalls("timeout"), modelCalls.filter((event) => event.outcome !== "cancelled").length),
      illegalOutputRate: rate(
        countCalls("illegal_output"),
        modelCalls.filter((event) => event.outcome !== "cancelled").length
      ),
      fallbackRate: rate(
        decisions.filter((event) => event.source === "fallback").length,
        decisions.filter((event) => event.source !== "cancelled").length
      ),
      cancelRate: rate(decisions.filter((event) => event.source === "cancelled").length, decisions.length),
      groups
    };
  }

  reset() {
    this.events = [];
  }
}

// 生产单例；测试可注入独立实例。
export const agentTelemetry = new AgentTelemetry();
