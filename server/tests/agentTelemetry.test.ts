import { describe, expect, it } from "vitest";
import { AgentTelemetry } from "../src/agent/telemetry.js";

describe("AgentTelemetry", () => {
  it("keeps cancelled work out of failure-rate denominators", () => {
    const telemetry = new AgentTelemetry(() => {});
    const commonCall = {
      task: "turn" as const,
      seatId: "A",
      attemptId: "attempt-a",
      levelId: "level-01",
      playerCount: 2
    };
    telemetry.recordModelCall({ ...commonCall, outcome: "cancelled" });
    telemetry.recordModelCall({ ...commonCall, outcome: "timeout" });

    const commonDecision = {
      seatId: "A",
      attemptId: "attempt-a",
      phaseVersion: 1,
      turnVersion: 1,
      levelId: "level-01",
      playerCount: 2,
      decisionEndToEndLatencyMs: 10
    };
    telemetry.recordTurnDecision({ ...commonDecision, source: "cancelled" });
    telemetry.recordTurnDecision({ ...commonDecision, source: "fallback", fallbackReason: "timeout" });

    const snapshot = telemetry.snapshot();
    expect(snapshot.deadlineMissRate).toBe(1);
    expect(snapshot.fallbackRate).toBe(1);
    expect(snapshot.cancelRate).toBe(0.5);
    expect(snapshot.groups[0]?.deadlineMissRate).toBe(1);
    expect(snapshot.groups[0]?.fallbackRate).toBe(1);
  });
});
