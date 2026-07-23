import type { ModelClient, ModelTask } from "../agent/modelClient.js";
import { systemPromptFor } from "../agent/prompts.js";
import { maxOutputTokensFor } from "../agent/providerConfig.js";
import { abortModelRequest } from "../agent/modelAbort.js";
import { modelAbortReason } from "../agent/modelAbort.js";
import { percentile } from "../agent/telemetry.js";

// Provider 契约评测（M9.2 第 12 条）：对固定 prompt 逐条调用模型，
// 统计延迟分位数、非法输出率与 Provider 错误率。mock 与真实模型均可运行。
export interface ProviderContractCase {
  id: string;
  task: ModelTask;
  prompt: string;
  // 返回内容是否满足该 case 的输出契约（通常为 JSON schema 校验）。
  validate: (content: string) => boolean;
  deadlineMs?: number;
}

export interface ProviderContractCaseResult {
  id: string;
  task: ModelTask;
  callKind: "cold_start" | "continuous";
  outcome: "ok" | "illegal_output" | "provider_error" | "timeout";
  latencyMs: number | null;
  tokensIn: number;
  tokensOut: number;
}

export interface ProviderContractSummary {
  total: number;
  ok: number;
  illegalOutput: number;
  providerErrors: number;
  deadlineMisses: number;
  fallbacks: number;
  illegalOutputRate: number;
  providerErrorRate: number;
  deadlineMissRate: number;
  fallbackRate: number;
  latencyMs: { p50: number | null; p95: number | null; p99: number | null };
  tokenUsage: { input: number; output: number; total: number };
}

export interface ProviderContractReport extends ProviderContractSummary {
  byTask: Partial<Record<ModelTask, ProviderContractSummary>>;
  coldStart: ProviderContractSummary;
  continuous: ProviderContractSummary;
  cases: ProviderContractCaseResult[];
}

const summarize = (results: ProviderContractCaseResult[]): ProviderContractSummary => {
  const latencies = results
    .map((result) => result.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const count = (outcome: ProviderContractCaseResult["outcome"]) =>
    results.filter((result) => result.outcome === outcome).length;
  const rate = (value: number) => (results.length === 0 ? 0 : value / results.length);
  const illegalOutput = count("illegal_output");
  const providerErrors = count("provider_error");
  const deadlineMisses = count("timeout");
  // 契约层不执行生产动作，但任意非 ok 结果在生产中都会进入 fallback。
  const fallbacks = results.length - count("ok");
  const tokensIn = results.reduce((sum, result) => sum + result.tokensIn, 0);
  const tokensOut = results.reduce((sum, result) => sum + result.tokensOut, 0);
  return {
    total: results.length,
    ok: count("ok"),
    illegalOutput,
    providerErrors,
    deadlineMisses,
    fallbacks,
    illegalOutputRate: rate(illegalOutput),
    providerErrorRate: rate(providerErrors),
    deadlineMissRate: rate(deadlineMisses),
    fallbackRate: rate(fallbacks),
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99) },
    tokenUsage: { input: tokensIn, output: tokensOut, total: tokensIn + tokensOut }
  };
};

export const runProviderContract = async (
  client: ModelClient,
  cases: ProviderContractCase[]
): Promise<ProviderContractReport> => {
  const results: ProviderContractCaseResult[] = [];
  const seenTasks = new Set<ModelTask>();

  for (const contractCase of cases) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const callKind = seenTasks.has(contractCase.task) ? "continuous" : "cold_start";
    seenTasks.add(contractCase.task);
    const deadline = setTimeout(() => abortModelRequest(controller, "deadline"), contractCase.deadlineMs ?? 10_000);
    try {
      const response = await client.complete({
        task: contractCase.task,
        system: systemPromptFor(contractCase.task),
        prompt: contractCase.prompt,
        signal: controller.signal,
        attemptId: `provider-contract:${contractCase.id}`,
        maxOutputTokens: maxOutputTokensFor(contractCase.task)
      });
      results.push({
        id: contractCase.id,
        task: contractCase.task,
        callKind,
        outcome: contractCase.validate(response.content) ? "ok" : "illegal_output",
        latencyMs: response.latencyMs ?? Date.now() - startedAt,
        tokensIn: response.tokensIn ?? 0,
        tokensOut: response.tokensOut ?? 0
      });
    } catch {
      results.push({
        id: contractCase.id,
        task: contractCase.task,
        callKind,
        outcome: modelAbortReason(controller.signal) === "deadline" ? "timeout" : "provider_error",
        latencyMs: Date.now() - startedAt,
        tokensIn: 0,
        tokensOut: 0
      });
    } finally {
      clearTimeout(deadline);
    }
  }

  const tasks = [...new Set(results.map((result) => result.task))];
  const byTask = Object.fromEntries(
    tasks.map((task) => [task, summarize(results.filter((result) => result.task === task))])
  ) as Partial<Record<ModelTask, ProviderContractSummary>>;

  return {
    ...summarize(results),
    byTask,
    coldStart: summarize(results.filter((result) => result.callKind === "cold_start")),
    continuous: summarize(results.filter((result) => result.callKind === "continuous")),
    cases: results
  };
};
