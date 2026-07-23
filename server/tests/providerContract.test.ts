import { describe, expect, it } from "vitest";
import { MockModelClient } from "../src/agent/modelClient.js";
import { turnDecisionSchema } from "../src/agent/orchestrator.js";
import { runProviderContract, type ProviderContractCase } from "../src/agentlab/providerContract.js";

const isJson = (content: string) => {
  try {
    JSON.parse(content);
    return true;
  } catch {
    return false;
  }
};

describe("runProviderContract", () => {
  it("classifies ok, illegal output and provider errors with latency percentiles", async () => {
    const outputs = new Map<string, () => Promise<{ content: string; latencyMs?: number }>>([
      ["case-ok", async () => ({ content: JSON.stringify({ cardId: "w1", segment: 2, revealIntent: "no" }), latencyMs: 120 })],
      ["case-bad-json", async () => ({ content: "我觉得放区6", latencyMs: 80 })],
      [
        "case-error",
        async () => {
          throw new Error("429 rate limited");
        }
      ]
    ]);

    let index = 0;
    const order = ["case-ok", "case-bad-json", "case-error"];
    const client = new MockModelClient(async () => {
      const handler = outputs.get(order[index]!);
      index += 1;
      return handler!();
    });

    const cases: ProviderContractCase[] = order.map((id) => ({
      id,
      task: "turn",
      prompt: "{}",
      validate: (content) => isJson(content) && turnDecisionSchema.safeParse(JSON.parse(content)).success
    }));

    const report = await runProviderContract(client, cases);

    expect(report.total).toBe(3);
    expect(report.ok).toBe(1);
    expect(report.illegalOutput).toBe(1);
    expect(report.providerErrors).toBe(1);
    expect(report.illegalOutputRate).toBeCloseTo(1 / 3);
    expect(report.providerErrorRate).toBeCloseTo(1 / 3);
    expect(report.fallbackRate).toBeCloseTo(2 / 3);
    expect(report.latencyMs.p50).toBe(80);
    expect(report.latencyMs.p95).toBe(120);
    expect(report.deadlineMissRate).toBe(0);
    expect(report.byTask.turn?.total).toBe(3);
    expect(report.coldStart.total).toBe(1);
    expect(report.continuous.total).toBe(2);
    expect(report.cases.map((result) => result.callKind)).toEqual(["cold_start", "continuous", "continuous"]);
    expect(report.cases.map((result) => result.outcome)).toEqual(["ok", "illegal_output", "provider_error"]);
  });

  it("reports deadline misses separately from provider errors", async () => {
    const client = new MockModelClient(
      (request) =>
        new Promise((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        })
    );

    const report = await runProviderContract(client, [
      { id: "timeout", task: "turn", prompt: "{}", deadlineMs: 5, validate: () => true }
    ]);

    expect(report.deadlineMisses).toBe(1);
    expect(report.deadlineMissRate).toBe(1);
    expect(report.providerErrors).toBe(0);
    expect(report.cases[0]?.outcome).toBe("timeout");
  });

  it("returns zero rates for an empty suite", async () => {
    const client = new MockModelClient(async () => ({ content: "{}" }));
    const report = await runProviderContract(client, []);
    expect(report.total).toBe(0);
    expect(report.illegalOutputRate).toBe(0);
    expect(report.deadlineMissRate).toBe(0);
    expect(report.fallbackRate).toBe(0);
    expect(report.latencyMs.p50).toBeNull();
  });
});
