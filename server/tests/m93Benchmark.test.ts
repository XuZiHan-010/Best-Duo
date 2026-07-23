import { describe, expect, it } from "vitest";
import { frozenM93Fixtures, runM93Benchmark } from "../src/agentlab/benchmark.js";

describe("M9.3 paired benchmark", () => {
  it("冻结清单覆盖三关和 2/3/4 人，正式规模每关不少于 60 seed", () => {
    const fixtures = frozenM93Fixtures();
    expect(fixtures).toHaveLength(180);
    expect(new Set(fixtures.map((fixture) => fixture.levelId))).toEqual(
      new Set(["level-01", "level-04", "level-08"])
    );
    expect(new Set(fixtures.map((fixture) => fixture.playerCount))).toEqual(new Set([2, 3, 4]));
  });

  it("开发规模同时产出候选质量与协调遵守配对置信区间", async () => {
    const report = await runM93Benchmark({ seedsPerLevel: 3 });
    expect(report.candidateQuality.samples).toBe(9);
    expect(report.coordinationAdherence.samples).toBe(9);
    expect(report.samplingValue.samples).toBe(9);
    expect(report.candidateQuality.ci95).toHaveLength(2);
    expect(report.coordinationAdherence.candidateRate).toBe(1);
    // 合理性闸门覆盖完整 12 手轨迹，不再只检查每个 fixture 的第一手。
    expect(report.reasonablePlacement).toMatchObject({ samples: 108, rate: 1, pass: true });
    expect(report.hintReasonableness.samples).toBe(108);
    expect(report.beliefConsistency.samples).toBeGreaterThan(9);
    expect(report.hintReasonableness.pass).toBe(true);
    expect(report.beliefConsistency.pass).toBe(true);
    expect(report.releaseGatePass).toBe(true);
    expect(report.candidateQuality.referenceOnly).toBe(true);
    expect(report.modelSelectorEvaluated).toBe(false);
  });
});
