import type { SeatId } from "@take-time/shared";
import type { EvalFixture } from "./fixtures.js";
import { runAttempt, runSingleStep, type RunnerDeps } from "./runner.js";
import { createCandidateSeatPolicy, createSafeSeatPolicy } from "./seatPolicies.js";

export interface PairedEstimate {
  samples: number;
  baselineRate: number;
  candidateRate: number;
  difference: number;
  ci95: [number, number];
}

export interface CandidateBenchmarkReport {
  suiteVersion: string;
  frozenAt: string;
  candidateQuality: PairedEstimate & { pass: boolean; requiredLowerBound: number; referenceOnly: true };
  coordinationAdherence: PairedEstimate & { pass: boolean; requiredLowerBound: number };
  samplingValue: PairedEstimate & { pass: boolean; requiredLowerBound: number; referenceOnly: true };
  reasonablePlacement: RateEstimate;
  hintReasonableness: RateEstimate;
  beliefConsistency: RateEstimate;
  releaseGatePass: boolean;
  byLevel: Record<string, PairedEstimate>;
  modelSelectorEvaluated: false;
  modelSelectorDefault: "disabled";
}

export interface RateEstimate {
  samples: number;
  rate: number;
  requiredRate: number;
  pass: boolean;
}

const rateEstimate = (values: boolean[], requiredRate = 1): RateEstimate => {
  const rate = values.length ? values.filter(Boolean).length / values.length : 0;
  return { samples: values.length, rate, requiredRate, pass: rate >= requiredRate };
};

const estimate = (pairs: Array<{ baseline: boolean; candidate: boolean }>): PairedEstimate => {
  const values = pairs.map(({ baseline, candidate }) => Number(candidate) - Number(baseline));
  const samples = pairs.length;
  const difference = samples ? values.reduce((sum, value) => sum + value, 0) / samples : 0;
  const variance = samples > 1
    ? values.reduce((sum, value) => sum + (value - difference) ** 2, 0) / (samples - 1)
    : 0;
  const margin = 1.96 * Math.sqrt(variance / Math.max(1, samples));
  return {
    samples,
    baselineRate: samples ? pairs.filter((pair) => pair.baseline).length / samples : 0,
    candidateRate: samples ? pairs.filter((pair) => pair.candidate).length / samples : 0,
    difference,
    ci95: [difference - margin, difference + margin]
  };
};

export const frozenM93Fixtures = (seedsPerLevel = 60): EvalFixture[] => {
  const levels = ["level-01", "level-04", "level-08"];
  const players = [2, 3, 4] as const;
  return levels.flatMap((levelId) =>
    Array.from({ length: seedsPerLevel }, (_, index) => {
      const playerCount = players[index % players.length];
      const policies = Object.fromEntries(
        (["A", "B", "C", "D"] as SeatId[]).slice(0, playerCount).map((seatId) => [seatId, "benchmark"])
      );
      return {
        suiteVersion: "m9.3-reasonable-v3-independent",
        levelId,
        playerCount,
        seatPolicies: policies,
        dealSeed: `m9.3:${levelId}:${playerCount}:${index}`,
        samplingSeed: `m9.3-sampling:${levelId}:${playerCount}:${index}`
      };
    })
  );
};

const deps = (kind: "safe" | "candidate" | "candidate_sampling"): RunnerDeps => ({
  createPolicy: (_seatId, _policyName, context) =>
    kind === "safe"
      ? createSafeSeatPolicy()
      : createCandidateSeatPolicy({
          samplingSeed: context.samplingSeed,
          sampling: kind === "candidate_sampling"
        })
});

export const runM93Benchmark = async (options: { seedsPerLevel?: number } = {}): Promise<CandidateBenchmarkReport> => {
  const fixtures = frozenM93Fixtures(options.seedsPerLevel ?? 60);
  const qualityPairs: Array<{ baseline: boolean; candidate: boolean; levelId: string }> = [];
  const samplingPairs: Array<{ baseline: boolean; candidate: boolean }> = [];
  const reasonablePlacements: boolean[] = [];
  const reasonableHints: boolean[] = [];
  const consistentBeliefs: boolean[] = [];
  for (const fixture of fixtures) {
    const [baseline, candidate, sampled] = await Promise.all([
      runAttempt(fixture, deps("safe")),
      runAttempt(fixture, deps("candidate")),
      runAttempt(fixture, deps("candidate_sampling"))
    ]);
    qualityPairs.push({ baseline: baseline.pass, candidate: candidate.pass, levelId: fixture.levelId });
    samplingPairs.push({ baseline: candidate.pass, candidate: sampled.pass });
    reasonablePlacements.push(...candidate.audits.reasonablePlacements);
    reasonableHints.push(...candidate.audits.reasonableHints);
    consistentBeliefs.push(...candidate.audits.consistentBeliefs);
  }

  const coordinationPairs: Array<{ baseline: boolean; candidate: boolean }> = [];
  for (const fixture of fixtures) {
    const assignedSegment = fixture.playerCount - 2;
    // 协调增益基线必须是同一候选引擎但不注入分工，避免把候选质量和
    // 协调规则两个变量混在同一配对里。
    const baseline = await runSingleStep(fixture, deps("candidate"));
    const candidate = await runSingleStep(fixture, {
      createPolicy: (_seatId, _name, context) =>
        createCandidateSeatPolicy({ samplingSeed: context.samplingSeed, assignedSegment })
    });
    coordinationPairs.push({
      baseline: baseline.decision.segment === assignedSegment,
      candidate: candidate.decision.segment === assignedSegment
    });
  }

  const candidateQuality = estimate(qualityPairs);
  const coordinationAdherence = estimate(coordinationPairs);
  const samplingValue = estimate(samplingPairs);
  const reasonablePlacement = rateEstimate(reasonablePlacements);
  const hintReasonableness = rateEstimate(reasonableHints);
  const beliefConsistency = rateEstimate(consistentBeliefs);
  const requiredQualityLowerBound = 0.1;
  const requiredCoordinationLowerBound = 0;
  const byLevel = Object.fromEntries(
    ["level-01", "level-04", "level-08"].map((levelId) => [
      levelId,
      estimate(qualityPairs.filter((pair) => pair.levelId === levelId))
    ])
  );
  return {
    suiteVersion: "m9.3-reasonable-v3-independent",
    frozenAt: "2026-07-23",
    candidateQuality: {
      ...candidateQuality,
      pass: candidateQuality.ci95[0] >= requiredQualityLowerBound,
      requiredLowerBound: requiredQualityLowerBound,
      referenceOnly: true
    },
    coordinationAdherence: {
      ...coordinationAdherence,
      pass: coordinationAdherence.ci95[0] > requiredCoordinationLowerBound,
      requiredLowerBound: requiredCoordinationLowerBound
    },
    samplingValue: {
      ...samplingValue,
      pass: samplingValue.ci95[0] > 0,
      requiredLowerBound: 0,
      referenceOnly: true
    },
    reasonablePlacement,
    hintReasonableness,
    beliefConsistency,
    releaseGatePass:
      coordinationAdherence.candidateRate === 1 &&
      reasonablePlacement.pass &&
      hintReasonableness.pass &&
      beliefConsistency.pass,
    byLevel,
    modelSelectorEvaluated: false,
    modelSelectorDefault: "disabled"
  };
};
