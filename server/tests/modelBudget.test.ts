import { describe, expect, it } from "vitest";
import { BudgetExceededError, BudgetedModelClient, ModelCallBudget } from "../src/agent/budget.js";
import { MockModelClient } from "../src/agent/modelClient.js";
import type { AgentBudgetConfig } from "../src/agent/providerConfig.js";

const budgetConfig = (overrides: Partial<AgentBudgetConfig> = {}): AgentBudgetConfig => ({
  attemptMaxCalls: 100,
  attemptMaxTokens: 1_000_000,
  dailyMaxCalls: 1_000,
  dailyMaxTokens: 10_000_000,
  ...overrides
});

describe("ModelCallBudget", () => {
  it("blocks calls beyond the per-attempt call limit and resets on a new attempt", () => {
    const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 2 }));
    budget.beginAttempt();
    budget.recordCall(10);
    budget.recordCall(10);
    expect(() => budget.assertCanCall()).toThrow(BudgetExceededError);

    budget.beginAttempt();
    expect(() => budget.assertCanCall()).not.toThrow();
  });

  it("blocks calls once the per-attempt token budget is exhausted", () => {
    const budget = new ModelCallBudget(budgetConfig({ attemptMaxTokens: 100 }));
    budget.beginAttempt();
    budget.recordCall(100);
    expect(() => budget.assertCanCall()).toThrow(/attempt\/tokens/);
  });

  it("keeps daily counters across attempts and rotates them on a new day", () => {
    let now = Date.parse("2026-07-15T10:00:00Z");
    const budget = new ModelCallBudget(budgetConfig({ dailyMaxCalls: 2 }), () => now);
    budget.beginAttempt();
    budget.recordCall(0);
    budget.recordCall(0);
    budget.beginAttempt();
    expect(() => budget.assertCanCall()).toThrow(/daily\/calls/);

    now = Date.parse("2026-07-16T00:01:00Z");
    expect(() => budget.assertCanCall()).not.toThrow();
  });
});

describe("BudgetedModelClient", () => {
  it("reserves call quota before await so concurrent requests cannot exceed the limit", async () => {
    let release: (() => void) | undefined;
    const inner = new MockModelClient(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ content: "{}", tokensIn: 1, tokensOut: 1 });
        })
    );
    const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 1 }));
    budget.beginAttempt("attempt-a");
    const client = new BudgetedModelClient(inner, budget);

    const first = client.complete({ task: "turn", prompt: "p", attemptId: "attempt-a" });
    await expect(
      client.complete({ task: "turn", prompt: "p", attemptId: "attempt-a" })
    ).rejects.toBeInstanceOf(BudgetExceededError);
    release?.();
    await first;
    expect(budget.snapshot("attempt-a").attemptCalls).toBe(1);
  });

  it("settles a late response against its original attempt", async () => {
    let release: (() => void) | undefined;
    const inner = new MockModelClient(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ content: "{}", tokensIn: 7, tokensOut: 3 });
        })
    );
    const budget = new ModelCallBudget(budgetConfig());
    budget.beginAttempt("attempt-a");
    const client = new BudgetedModelClient(inner, budget);
    const pending = client.complete({ task: "turn", prompt: "p", attemptId: "attempt-a" });

    budget.beginAttempt("attempt-b");
    release?.();
    await pending;

    expect(budget.snapshot("attempt-a").attemptTokens).toBe(10);
    expect(budget.snapshot("attempt-b").attemptTokens).toBe(0);
  });

  it("throws BudgetExceededError before calling the provider when exhausted", async () => {
    let calls = 0;
    const inner = new MockModelClient(async () => {
      calls += 1;
      return { content: "{}", tokensIn: 5, tokensOut: 5 };
    });
    const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 1 }));
    budget.beginAttempt();
    const client = new BudgetedModelClient(inner, budget);

    await client.complete({ task: "turn", prompt: "p" });
    await expect(client.complete({ task: "turn", prompt: "p" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(calls).toBe(1);
  });

  it("counts successful usage and conservatively keeps failed-call reservations", async () => {
    let shouldFail = false;
    const inner = new MockModelClient(async () => {
      if (shouldFail) throw new Error("provider down");
      return { content: "{}", tokensIn: 30, tokensOut: 20 };
    });
    const budget = new ModelCallBudget(budgetConfig());
    budget.beginAttempt();
    const client = new BudgetedModelClient(inner, budget);

    await client.complete({ task: "turn", prompt: "p" });
    shouldFail = true;
    await expect(client.complete({ task: "turn", prompt: "fail", maxOutputTokens: 20 })).rejects.toThrow(
      "provider down"
    );

    const snapshot = budget.snapshot();
    expect(snapshot.attemptCalls).toBe(2);
    expect(snapshot.attemptTokens).toBe(74);
    expect(snapshot.attemptReservedTokens).toBe(0);
  });

  // P1-1b（2026-07-21 findings）：去掉讨论发言上限后，非 turn 任务不得吃光
  // 共享 attempt 预算，必须至少给本局剩余 AI 出牌留出 turn 调用额度。
  describe("turn 调用额度预留", () => {
    it("non-turn calls cannot eat into the reserved turn quota", () => {
      const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 6 }));
      budget.beginAttempt("attempt-1", { reservedTurnCalls: 3 });

      // 6 - 3 = 3 次非 turn 额度。
      budget.recordCall(0, "attempt-1", "discussion");
      budget.recordCall(0, "attempt-1", "discussion");
      budget.recordCall(0, "attempt-1", "discussion");
      expect(() => budget.recordCall(0, "attempt-1", "discussion")).toThrow(/attempt\/calls/);

      // 预留的 turn 额度完好：3 次出牌全部可用。
      budget.recordCall(0, "attempt-1", "turn");
      budget.recordCall(0, "attempt-1", "turn");
      budget.recordCall(0, "attempt-1", "turn");
      expect(() => budget.recordCall(0, "attempt-1", "turn")).toThrow(/attempt\/calls/);
    });

    it("turn calls consume the reserve first and free headroom for non-turn calls", () => {
      const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 6 }));
      budget.beginAttempt("attempt-1", { reservedTurnCalls: 3 });

      // 出牌先行消耗预留：剩余预留 2，非 turn 可用 6-1-2=3。
      budget.recordCall(0, "attempt-1", "turn");
      budget.recordCall(0, "attempt-1", "discussion");
      budget.recordCall(0, "attempt-1", "discussion");
      budget.recordCall(0, "attempt-1", "discussion");
      expect(() => budget.recordCall(0, "attempt-1", "discussion")).toThrow(/attempt\/calls/);
    });

    it("without a reserve non-turn calls can use the whole attempt budget", () => {
      const budget = new ModelCallBudget(budgetConfig({ attemptMaxCalls: 2 }));
      budget.beginAttempt("attempt-1");
      budget.recordCall(0, "attempt-1", "discussion");
      budget.recordCall(0, "attempt-1", "discussion");
      expect(() => budget.recordCall(0, "attempt-1", "discussion")).toThrow(/attempt\/calls/);
    });
  });

  // 2026-07-21 findings 修复：出牌预留此前只挡"次数"、不挡"token"。讨论去掉
  // 发言上限后，把 attempt token 预算聊穿，出牌照样 budget_exceeded 盲打。
  // 预留必须同时锁住 turn 的 token 份额。
  describe("turn token 额度预留", () => {
    it("non-turn calls cannot eat into the reserved turn token budget", () => {
      const budget = new ModelCallBudget(budgetConfig({ attemptMaxTokens: 100 }));
      budget.beginAttempt("attempt-1", { reservedTurnCalls: 1, reservedTurnTokens: 60 });

      // 100 - 60 = 40 token 可供非 turn 任务使用。
      budget.recordCall(40, "attempt-1", "discussion");
      expect(() => budget.recordCall(1, "attempt-1", "discussion")).toThrow(/attempt\/tokens/);

      // 预留的 60 token 完好，出牌可以用满。
      expect(() => budget.recordCall(60, "attempt-1", "turn")).not.toThrow();
    });

    it("turn calls draw down the token reserve, freeing headroom for non-turn tasks", () => {
      const budget = new ModelCallBudget(budgetConfig({ attemptMaxTokens: 100 }));
      budget.beginAttempt("attempt-1", { reservedTurnCalls: 2, reservedTurnTokens: 60 });

      // 出牌先用掉 20 token 预留 → 预留剩 40 → 非 turn 上限 = 100 - 40 = 60，其中出牌已占 20。
      budget.recordCall(20, "attempt-1", "turn");
      budget.recordCall(40, "attempt-1", "discussion");
      expect(() => budget.recordCall(1, "attempt-1", "discussion")).toThrow(/attempt\/tokens/);
    });
  });
});
