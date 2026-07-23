import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_SAMPLING_MAX_CANDIDATES,
  DEFAULT_SAMPLING_MAX_MS,
  DEFAULT_SAMPLING_WORLD_COUNT
} from "./types.js";

type Env = Record<string, string | undefined>;

const readBoolean = (env: Env, name: string, fallback: boolean): boolean => {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
};

const readNonNegativeNumber = (env: Env, name: string, fallback: number): number => {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};

export interface CandidateRuntimeConfig {
  candidateEngineEnabled: boolean;
  modelTopKOnly: boolean;
  candidateConfidenceThreshold: number;
  hiddenSamplingEnabled: boolean;
  samplingWorldCount: number;
  samplingMaxCandidates: number;
  samplingMaxMs: number;
}

export const loadCandidateRuntimeConfig = (env: Env = process.env): CandidateRuntimeConfig => ({
  // v2 合理性闸门存在自证问题；完成独立完整轨迹评测并重新签署前默认关闭。
  candidateEngineEnabled: readBoolean(env, "AGENT_CANDIDATE_ENGINE_V1", false),
  // 主路径一旦开启，默认启用 top-K 硬边界；显式关闭时运行纯候选 #1 基线。
  modelTopKOnly: readBoolean(env, "AGENT_MODEL_TOP_K_ONLY", true),
  candidateConfidenceThreshold: readNonNegativeNumber(
    env,
    "AGENT_CANDIDATE_CONFIDENCE_THRESHOLD",
    DEFAULT_CONFIDENCE_THRESHOLD
  ),
  hiddenSamplingEnabled: readBoolean(env, "AGENT_HIDDEN_SAMPLING_V1", false),
  samplingWorldCount: readNonNegativeNumber(env, "AGENT_SAMPLING_WORLD_COUNT", DEFAULT_SAMPLING_WORLD_COUNT),
  samplingMaxCandidates: readNonNegativeNumber(
    env,
    "AGENT_SAMPLING_MAX_CANDIDATES",
    DEFAULT_SAMPLING_MAX_CANDIDATES
  ),
  samplingMaxMs: readNonNegativeNumber(env, "AGENT_SAMPLING_MAX_MS", DEFAULT_SAMPLING_MAX_MS)
});
