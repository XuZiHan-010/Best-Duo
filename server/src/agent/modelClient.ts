export type ModelTask = "discussion" | "turn" | "retry_brief";

export interface ModelRequest {
  task: ModelTask;
  prompt: string;
  // 预算账本与 telemetry 的稳定归属；离线契约测试可使用固定 synthetic id。
  attemptId?: string;
  // 任务级系统指令（输出契约、可见性口径等）；adapter 映射为 system message。
  system?: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
  // 按请求覆盖推理档位（如策略收口用 low 压延迟）；缺省时用 route 配置。
  reasoningEffort?: "none" | "low" | "medium" | "high";
}

export interface ModelResponse {
  content: string;
  tokensIn?: number;
  tokensOut?: number;
  latencyMs?: number;
  provider?: string;
  model?: string;
}

// Provider 无关的模型调用接口；OpenAI / DeepSeek adapter 见 providers.ts。
export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
}

export class MockModelClient implements ModelClient {
  constructor(private readonly handler: (request: ModelRequest) => Promise<ModelResponse>) {}

  complete(request: ModelRequest): Promise<ModelResponse> {
    return this.handler(request);
  }
}

// M9.2 之前 / 未配置 API key 时的默认 client：模型调用直接失败，
// Agent 保持沉默、锁定空策略、出牌走兜底，纯真人流程行为不变。
export class UnconfiguredModelClient implements ModelClient {
  complete(): Promise<never> {
    return Promise.reject(new Error("未配置模型 Provider"));
  }
}
