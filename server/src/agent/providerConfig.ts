import type { ModelTask } from "./modelClient.js";

export type AgentProviderName = "openai" | "deepseek";

// 单个任务的模型路由：provider + baseURL + key + model。
export interface TaskModelRoute {
  provider: AgentProviderName;
  baseURL: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

// 模型调用预算：调用次数与 token 双上限，覆盖全部模型调用
// （决策、讨论发言含实体提取、结果阶段 RetryBrief 生成）。
export interface AgentBudgetConfig {
  attemptMaxCalls: number;
  attemptMaxTokens: number;
  dailyMaxCalls: number;
  dailyMaxTokens: number;
}

export interface AgentProviderConfig {
  // 只包含"对应 provider 的 API key 已配置"的任务；缺 key 的任务
  // 保持未配置降级（Agent 沉默 / 出牌走兜底），纯真人流程不受影响。
  routes: Partial<Record<ModelTask, TaskModelRoute>>;
  budget: AgentBudgetConfig;
}

const PROVIDER_DEFAULTS: Record<AgentProviderName, { baseURL: string; keyEnv: string; baseURLEnv: string }> = {
  openai: { baseURL: "https://api.openai.com/v1", keyEnv: "OPENAI_API_KEY", baseURLEnv: "OPENAI_BASE_URL" },
  deepseek: { baseURL: "https://api.deepseek.com", keyEnv: "DEEPSEEK_API_KEY", baseURLEnv: "DEEPSEEK_BASE_URL" }
};

// 现行候选（2026-07-17 真实联调实测后定档，取代 M9.2 初始候选）：
// - discussion 用 gpt-5.4 + low：实测 5-14s、全部合法 JSON，质量与 deepseek-v4-pro 相当；
//   pro 是推理模型，思维链与正文共用 max_tokens 且延迟 26-69s，无法满足对话节奏。
// - turn 使用 gpt-5.4-mini + none；出牌只需短 JSON，关闭额外推理能降低尾延迟，
//   仍由服务端合法性校验与安全策略兜底。上限 2000 避免结构化正文被截断。
// - retry_brief 用 deepseek-v4-flash：非实时任务，flash 推理量小（实测 188-988 token）、
//   延迟稳定，pro 的推理波动会有超 deadline 风险。
const TASK_DEFAULTS: Record<
  ModelTask,
  {
    provider: AgentProviderName;
    model: string;
    envPrefix: string;
    maxOutputTokens: number;
    reasoningEffort?: TaskModelRoute["reasoningEffort"];
  }
> = {
  discussion: {
    provider: "openai",
    model: "gpt-5.4",
    envPrefix: "AGENT_DISCUSSION",
    maxOutputTokens: 4_000,
    reasoningEffort: "low"
  },
  turn: {
    provider: "openai",
    model: "gpt-5.4-mini",
    envPrefix: "AGENT_TURN",
    maxOutputTokens: 2_000,
    reasoningEffort: "none"
  },
  retry_brief: {
    provider: "deepseek",
    model: "deepseek-v4-flash",
    envPrefix: "AGENT_RETRY_BRIEF",
    maxOutputTokens: 2_000
  }
};

// 各任务输出 token 上限的单一来源：env 覆盖 > TASK_DEFAULTS。
// 调用方（orchestrator / strategyPlanner / 契约脚本）显式传入请求，
// 因为 BudgetedModelClient 需要在调用前拿到它做预算预留。
export const maxOutputTokensFor = (task: ModelTask, env: Env = process.env): number =>
  readPositiveInt(env, `${TASK_DEFAULTS[task].envPrefix}_MAX_OUTPUT_TOKENS`, TASK_DEFAULTS[task].maxOutputTokens);

const BUDGET_DEFAULTS: AgentBudgetConfig = {
  attemptMaxCalls: 40,
  attemptMaxTokens: 200_000,
  dailyMaxCalls: 500,
  dailyMaxTokens: 2_000_000
};

type Env = Record<string, string | undefined>;

const readString = (env: Env, name: string): string | null => {
  const raw = env[name]?.trim();
  return raw ? raw : null;
};

const readPositiveInt = (env: Env, name: string, fallback: number): number => {
  const raw = readString(env, name);
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const readProvider = (env: Env, name: string): AgentProviderName | null => {
  const raw = readString(env, name)?.toLowerCase();
  return raw === "openai" || raw === "deepseek" ? raw : null;
};

const readReasoningEffort = (env: Env, name: string): TaskModelRoute["reasoningEffort"] | null => {
  const raw = readString(env, name)?.toLowerCase();
  return raw === "none" || raw === "low" || raw === "medium" || raw === "high" ? raw : null;
};

const routeForTask = (env: Env, task: ModelTask): TaskModelRoute | null => {
  const defaults = TASK_DEFAULTS[task];
  const provider = readProvider(env, `${defaults.envPrefix}_PROVIDER`) ?? defaults.provider;
  const providerDefaults = PROVIDER_DEFAULTS[provider];
  const apiKey = readString(env, `${defaults.envPrefix}_API_KEY`) ?? readString(env, providerDefaults.keyEnv);
  if (!apiKey) return null;
  const reasoningEffort =
    readReasoningEffort(env, `${defaults.envPrefix}_REASONING_EFFORT`) ?? defaults.reasoningEffort;
  return {
    provider,
    baseURL:
      readString(env, `${defaults.envPrefix}_BASE_URL`) ??
      readString(env, providerDefaults.baseURLEnv) ??
      providerDefaults.baseURL,
    apiKey,
    model: readString(env, `${defaults.envPrefix}_MODEL`) ?? defaults.model,
    maxOutputTokens: readPositiveInt(
      env,
      `${defaults.envPrefix}_MAX_OUTPUT_TOKENS`,
      defaults.maxOutputTokens
    ),
    ...(reasoningEffort ? { reasoningEffort } : {})
  };
};

export const loadAgentProviderConfig = (env: Env = process.env): AgentProviderConfig => {
  const routes: AgentProviderConfig["routes"] = {};
  for (const task of Object.keys(TASK_DEFAULTS) as ModelTask[]) {
    const route = routeForTask(env, task);
    if (route) routes[task] = route;
  }
  return {
    routes,
    budget: {
      attemptMaxCalls: readPositiveInt(env, "AGENT_ATTEMPT_MAX_CALLS", BUDGET_DEFAULTS.attemptMaxCalls),
      attemptMaxTokens: readPositiveInt(env, "AGENT_ATTEMPT_MAX_TOKENS", BUDGET_DEFAULTS.attemptMaxTokens),
      dailyMaxCalls: readPositiveInt(env, "AGENT_DAILY_MAX_CALLS", BUDGET_DEFAULTS.dailyMaxCalls),
      dailyMaxTokens: readPositiveInt(env, "AGENT_DAILY_MAX_TOKENS", BUDGET_DEFAULTS.dailyMaxTokens)
    }
  };
};
