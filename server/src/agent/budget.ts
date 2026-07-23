import type { ModelClient, ModelRequest, ModelResponse, ModelTask } from "./modelClient.js";
import type { AgentBudgetConfig } from "./providerConfig.js";

// 预算超限与超时/Provider 错误/非法输出走同一降级状态机，
// 仅在 fallback reason 中区分 budget_exceeded。
export class BudgetExceededError extends Error {
  readonly reason = "budget_exceeded";

  constructor(readonly scope: "attempt" | "daily", readonly kind: "calls" | "tokens") {
    super(`模型调用预算超限（${scope}/${kind}）`);
    this.name = "BudgetExceededError";
  }
}

const dayKeyOf = (timestamp: number): string => new Date(timestamp).toISOString().slice(0, 10);

// 每 attempt 与每日（UTC）的调用次数 / token 双上限，覆盖全部模型调用。
export class ModelCallBudget {
  private readonly attempts = new Map<
    string,
    {
      calls: number;
      tokens: number;
      reservedTokens: number;
      turnReserveRemaining: number;
      turnTokenReserveRemaining: number;
    }
  >();
  private activeAttemptId = "__default__";
  private dailyCalls = 0;
  private dailyTokens = 0;
  private dailyReservedTokens = 0;
  private dayKey: string;

  constructor(
    private readonly config: AgentBudgetConfig,
    private readonly now: () => number = Date.now
  ) {
    this.dayKey = dayKeyOf(this.now());
  }

  // reservedTurnCalls / reservedTurnTokens：为本局剩余 AI 出牌预留的 turn
  // 调用次数与 token 额度（P1-1b）。讨论去掉发言上限后，非 turn 任务不得吃进
  // 这两份预留，防止出牌前预算被聊穿、整个出牌阶段全部 fallback。
  // 次数预留曾单独存在，但只挡次数不挡 token —— 讨论把 token 聊穿同样会让
  // 出牌 budget_exceeded（2026-07-21 findings 修复），因此两个维度都要预留。
  beginAttempt(
    attemptId = "__default__",
    options: { reservedTurnCalls?: number; reservedTurnTokens?: number } = {}
  ) {
    this.activeAttemptId = attemptId;
    this.attempts.set(attemptId, {
      calls: 0,
      tokens: 0,
      reservedTokens: 0,
      turnReserveRemaining: Math.max(0, options.reservedTurnCalls ?? 0),
      turnTokenReserveRemaining: Math.max(0, options.reservedTurnTokens ?? 0)
    });
  }

  private rotateDayIfNeeded() {
    const current = dayKeyOf(this.now());
    if (current !== this.dayKey) {
      this.dayKey = current;
      this.dailyCalls = 0;
      this.dailyTokens = 0;
      this.dailyReservedTokens = 0;
    }
  }

  private usageFor(attemptId: string) {
    const existing = this.attempts.get(attemptId);
    if (existing) return existing;
    const created = {
      calls: 0,
      tokens: 0,
      reservedTokens: 0,
      turnReserveRemaining: 0,
      turnTokenReserveRemaining: 0
    };
    this.attempts.set(attemptId, created);
    return created;
  }

  // 发起调用前原子预留调用次数和预计 token，避免并发请求同时穿透上限。
  // 非 turn 任务额外受 turn 预留约束；turn 任务优先消耗预留额度。
  reserveCall(attemptId = this.activeAttemptId, tokenReservation = 0, task?: ModelTask) {
    this.rotateDayIfNeeded();
    const usage = this.usageFor(attemptId);
    // 非 turn 任务额外受 turn 预留约束（次数 + token 两个维度）；turn 任务
    // 可以动用自己的预留，因此把预留计入 0。
    const protectedTurnTokens = task === "turn" ? 0 : usage.turnTokenReserveRemaining;
    if (usage.calls >= this.config.attemptMaxCalls) throw new BudgetExceededError("attempt", "calls");
    if (task !== "turn" && usage.calls + 1 + usage.turnReserveRemaining > this.config.attemptMaxCalls) {
      throw new BudgetExceededError("attempt", "calls");
    }
    if (usage.tokens + usage.reservedTokens + tokenReservation + protectedTurnTokens > this.config.attemptMaxTokens) {
      throw new BudgetExceededError("attempt", "tokens");
    }
    if (this.dailyCalls >= this.config.dailyMaxCalls) throw new BudgetExceededError("daily", "calls");
    if (this.dailyTokens + this.dailyReservedTokens + tokenReservation > this.config.dailyMaxTokens) {
      throw new BudgetExceededError("daily", "tokens");
    }
    usage.calls += 1;
    if (task === "turn" && usage.turnReserveRemaining > 0) usage.turnReserveRemaining -= 1;
    if (task === "turn" && usage.turnTokenReserveRemaining > 0) {
      usage.turnTokenReserveRemaining = Math.max(0, usage.turnTokenReserveRemaining - tokenReservation);
    }
    usage.reservedTokens += tokenReservation;
    this.dailyCalls += 1;
    this.dailyReservedTokens += tokenReservation;
    return { attemptId, tokenReservation };
  }

  // 保留旧的显式检查 API 给诊断/测试使用；真实调用必须走 reserveCall。
  assertCanCall(attemptId = this.activeAttemptId) {
    this.rotateDayIfNeeded();
    const usage = this.usageFor(attemptId);
    if (usage.calls >= this.config.attemptMaxCalls) throw new BudgetExceededError("attempt", "calls");
    if (usage.tokens + usage.reservedTokens >= this.config.attemptMaxTokens) {
      throw new BudgetExceededError("attempt", "tokens");
    }
    if (this.dailyCalls >= this.config.dailyMaxCalls) throw new BudgetExceededError("daily", "calls");
    if (this.dailyTokens + this.dailyReservedTokens >= this.config.dailyMaxTokens) {
      throw new BudgetExceededError("daily", "tokens");
    }
  }

  settleCall(reservation: { attemptId: string; tokenReservation: number }, actualTokens: number) {
    this.rotateDayIfNeeded();
    const usage = this.usageFor(reservation.attemptId);
    usage.reservedTokens = Math.max(0, usage.reservedTokens - reservation.tokenReservation);
    this.dailyReservedTokens = Math.max(0, this.dailyReservedTokens - reservation.tokenReservation);
    usage.tokens += Math.max(0, actualTokens);
    this.dailyTokens += Math.max(0, actualTokens);
  }

  // 测试/手工记账入口：一次性预留并结算。
  recordCall(tokens: number, attemptId = this.activeAttemptId, task?: ModelTask) {
    const reservation = this.reserveCall(attemptId, tokens, task);
    this.settleCall(reservation, tokens);
  }

  snapshot(attemptId = this.activeAttemptId) {
    this.rotateDayIfNeeded();
    const usage = this.usageFor(attemptId);
    return {
      attemptId,
      attemptCalls: usage.calls,
      attemptTokens: usage.tokens,
      attemptReservedTokens: usage.reservedTokens,
      dailyCalls: this.dailyCalls,
      dailyTokens: this.dailyTokens,
      dailyReservedTokens: this.dailyReservedTokens,
      dayKey: this.dayKey
    };
  }
}

// ModelClient 装饰器：调用前校验预算，返回后按实际 token 记账。
export class BudgetedModelClient implements ModelClient {
  constructor(
    private readonly inner: ModelClient,
    private readonly budget: ModelCallBudget
  ) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    // 用字符数作为保守上界，避免中文 prompt 按 4 chars/token 低估后穿透预算。
    const estimatedInputTokens = (request.system?.length ?? 0) + request.prompt.length;
    const tokenReservation = estimatedInputTokens + (request.maxOutputTokens ?? 0);
    const reservation = this.budget.reserveCall(request.attemptId, tokenReservation, request.task);
    try {
      const response = await this.inner.complete(request);
      this.budget.settleCall(
        reservation,
        (response.tokensIn ?? estimatedInputTokens) + (response.tokensOut ?? 0)
      );
      return response;
    } catch (error) {
      // 请求一旦进入 Provider，失败/取消时通常拿不到 usage，但输入和部分输出
      // 仍可能已经计费。保守按完整预留结算，保证 token 上限是真正的硬上限。
      this.budget.settleCall(reservation, tokenReservation);
      throw error;
    }
  }
}
