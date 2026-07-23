import { describe, expect, it } from "vitest";
import { evalFixtureSchema, type EvalFixture } from "../src/agentlab/fixtures.js";
import { runAttempt, runSingleStep } from "../src/agentlab/runner.js";
import { createScriptedSeatPolicy } from "../src/agentlab/seatPolicies.js";

const fixture: EvalFixture = {
  suiteVersion: "m9.0-smoke-1",
  levelId: "level-01",
  playerCount: 2,
  seatPolicies: { A: "scripted", B: "scripted" },
  dealSeed: "seed-alpha",
  samplingSeed: "seed-sampling"
};

describe("agent-lab eval runner skeleton", () => {
  it("validates fixtures against the schema", () => {
    expect(evalFixtureSchema.parse(fixture)).toEqual(fixture);
    expect(() => evalFixtureSchema.parse({ ...fixture, playerCount: 5 })).toThrow();
    expect(() => evalFixtureSchema.parse({ ...fixture, dealSeed: "" })).toThrow();
  });

  it("runs a full attempt through the action layer with scripted policies", async () => {
    const report = await runAttempt(fixture, { createPolicy: () => createScriptedSeatPolicy() });

    expect(report.totalPlacedCards).toBe(12);
    expect(report.phase).toBe("result");
    expect(report.revealResult).not.toBeNull();
    expect(report.segmentSums).toHaveLength(6);
  });

  it("replays the same fixture deterministically with a fixed deal seed", async () => {
    const first = await runAttempt(fixture, { createPolicy: () => createScriptedSeatPolicy() });
    const second = await runAttempt(fixture, { createPolicy: () => createScriptedSeatPolicy() });

    expect(second.dealtHands).toEqual(first.dealtHands);
    expect(second.segmentSums).toEqual(first.segmentSums);
    expect(second.pass).toBe(first.pass);
  });

  it("executes a single decision step without finishing the attempt", async () => {
    const step = await runSingleStep(fixture, { createPolicy: () => createScriptedSeatPolicy() });

    expect(step.decision.cardId).toBeTruthy();
    expect(step.decision.segment).toBeGreaterThanOrEqual(0);
    expect(step.decision.segment).toBeLessThanOrEqual(5);
    expect(step.totalPlacedCards).toBe(1);
    expect(step.phase).toBe("placing");
  });

  it("injects a deterministic per-seat RNG derived from samplingSeed", async () => {
    const samples: number[] = [];
    const createPolicy = (
      _seatId: string,
      _policyName: string,
      context: { samplingRng: () => number }
    ) => {
      samples.push(context.samplingRng());
      return createScriptedSeatPolicy();
    };

    await runSingleStep(fixture, { createPolicy });
    const firstRun = [...samples];
    samples.length = 0;
    await runSingleStep(fixture, { createPolicy });

    expect(samples).toEqual(firstRun);
    expect(samples).toHaveLength(fixture.playerCount);
  });
});
