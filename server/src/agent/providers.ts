import OpenAI from "openai";
import type { ModelClient, ModelRequest, ModelResponse, ModelTask } from "./modelClient.js";
import type { AgentProviderConfig, TaskModelRoute } from "./providerConfig.js";

// openai SDK 的结构化最小切面：便于测试注入假 client；
// DeepSeek 走同一套 OpenAI 兼容 chat.completions 接口，只差 baseURL。
export interface ChatCompletionsClient {
  chat: {
    completions: {
      create(
        body: {
          model: string;
          messages: Array<{ role: "system" | "user"; content: string }>;
          response_format?: { type: "json_object" };
          max_tokens?: number;
          max_completion_tokens?: number;
          reasoning_effort?: "none" | "low" | "medium" | "high";
        },
        options?: { signal?: AbortSignal }
      ): Promise<{
        choices: Array<{ message?: { content?: string | null } | null }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
      }>;
    };
  };
}

export class OpenAICompatModelClient implements ModelClient {
  private readonly client: ChatCompletionsClient;

  constructor(
    private readonly route: TaskModelRoute,
    client?: ChatCompletionsClient
  ) {
    this.client = client ?? new OpenAI({ apiKey: route.apiKey, baseURL: route.baseURL });
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const startedAt = Date.now();
    // 请求级推理档位优先于 route 配置；DeepSeek 与 OpenAI 同样支持 reasoning_effort
    //（此前 DeepSeek 分支静默丢弃该配置）。
    const reasoningEffort = request.reasoningEffort ?? this.route.reasoningEffort;
    let completion: Awaited<ReturnType<ChatCompletionsClient["chat"]["completions"]["create"]>>;
    try {
      completion = await this.client.chat.completions.create(
        {
          model: this.route.model,
          messages: [
            ...(request.system ? ([{ role: "system", content: request.system }] as const) : []),
            { role: "user", content: request.prompt }
          ],
          response_format: { type: "json_object" },
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
          ...(this.route.provider === "deepseek"
            ? { max_tokens: request.maxOutputTokens ?? this.route.maxOutputTokens }
            : { max_completion_tokens: request.maxOutputTokens ?? this.route.maxOutputTokens })
        },
        request.signal ? { signal: request.signal } : undefined
      );
    } catch (error) {
      throw new ProviderRequestError({
        provider: this.route.provider,
        model: this.route.model,
        latencyMs: Date.now() - startedAt,
        cause: error
      });
    }

    // 空响应属于非法模型输出，而不是 Provider 网络错误；交给上层 schema 统一分类。
    const content = completion.choices[0]?.message?.content ?? "";

    return {
      content,
      tokensIn: completion.usage?.prompt_tokens,
      tokensOut: completion.usage?.completion_tokens,
      latencyMs: Date.now() - startedAt,
      provider: this.route.provider,
      model: this.route.model
    };
  }
}

export class ProviderRequestError extends Error {
  readonly provider: string;
  readonly model: string;
  readonly latencyMs: number;

  constructor(input: { provider: string; model: string; latencyMs: number; cause: unknown }) {
    super(`模型 Provider 请求失败（${input.provider}/${input.model}）`, { cause: input.cause });
    this.name = "ProviderRequestError";
    this.provider = input.provider;
    this.model = input.model;
    this.latencyMs = input.latencyMs;
  }
}

// 按任务路由到各自的 provider/model；未配置的任务直接失败，
// 由上层统一走"未配置"降级（与整体 fallback 状态机一致）。
export class RoutingModelClient implements ModelClient {
  constructor(private readonly clients: Partial<Record<ModelTask, ModelClient>>) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    const client = this.clients[request.task];
    if (!client) return Promise.reject(new Error(`任务 ${request.task} 未配置模型 Provider`));
    return client.complete(request);
  }
}

// 从 env 配置构建路由 client；一个任务都没配置时返回 null，
// 调用方回退到 UnconfiguredModelClient（Agent 沉默 + 脚本兜底）。
export const createModelClientFromConfig = (
  config: AgentProviderConfig,
  clientFactory: (route: TaskModelRoute) => ModelClient = (route) => new OpenAICompatModelClient(route)
): ModelClient | null => {
  const clients: Partial<Record<ModelTask, ModelClient>> = {};
  for (const [task, route] of Object.entries(config.routes) as Array<[ModelTask, TaskModelRoute]>) {
    clients[task] = clientFactory(route);
  }
  if (Object.keys(clients).length === 0) return null;
  return new RoutingModelClient(clients);
};
