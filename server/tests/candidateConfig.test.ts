import { describe, expect, it } from "vitest";
import { loadCandidateRuntimeConfig } from "../src/agent/candidates/config.js";

describe("candidate runtime config", () => {
  it("keeps the candidate path off until the independent trajectory gate is signed", () => {
    expect(loadCandidateRuntimeConfig({})).toEqual({
      candidateEngineEnabled: false,
      modelTopKOnly: true,
      candidateConfidenceThreshold: 12,
      hiddenSamplingEnabled: false,
      samplingWorldCount: 8,
      samplingMaxCandidates: 12,
      samplingMaxMs: 30
    });
  });

  it("parses feature flags and a non-negative confidence threshold", () => {
    expect(
      loadCandidateRuntimeConfig({
        AGENT_CANDIDATE_ENGINE_V1: "on",
        AGENT_MODEL_TOP_K_ONLY: "0",
        AGENT_CANDIDATE_CONFIDENCE_THRESHOLD: "7.5"
      })
    ).toEqual({
      candidateEngineEnabled: true,
      modelTopKOnly: false,
      candidateConfidenceThreshold: 7.5,
      hiddenSamplingEnabled: false,
      samplingWorldCount: 8,
      samplingMaxCandidates: 12,
      samplingMaxMs: 30
    });
  });
});
