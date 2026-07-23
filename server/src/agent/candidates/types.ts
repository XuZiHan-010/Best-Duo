export interface CandidateAction {
  cardId: string;
  segment: number;
}

// 单个评分分量：可追溯"这张牌为什么排这个名"（codex review fix 6）。
export interface ScoreComponent {
  source: string; // 例："condition:segment-colors" / "assignment" / "gradient"
  detail?: string;
  contribution: number;
}

export interface ScoredCandidate extends CandidateAction {
  score: number;
  components: ScoreComponent[];
  appliedRuleIds: string[]; // 参与打分的结构化约定规则 id
}

export interface CandidateResult {
  evaluatorVersion: string;
  ranked: ScoredCandidate[]; // 已按分数降序、确定性排序；至少 1 个（全剪枝时回落 safePolicy）
  topK: CandidateAction[]; // ranked 前 K 个的动作投影
  // 硬约定与全部可执行候选冲突时，游戏合法性优先并显式记录放宽。
  relaxedRuleIds: string[];
  relaxations: Array<{
    ruleId: string;
    reason: "no_executable_candidate";
    beforeCount: number;
    afterCount: number;
  }>;
  sampling?: {
    version: string;
    requestedWorlds: number;
    generatedWorlds: number;
    evaluatedCandidates: number;
    evaluations: number;
    budgetExceeded: boolean;
    elapsedMs: number;
  };
}

export interface CandidateConfig {
  topK?: number;
  sampling?: {
    enabled: boolean;
    seed: string;
    worldCount?: number;
    maxCandidates?: number;
    maxMs?: number;
  };
}

// 评分器版本：权重/支持条件集变化必须升版，用于 telemetry 与 eval 复现。
export const EVALUATOR_VERSION = "m9.3-v3-belief";
export const DEFAULT_TOP_K = 6;
export const DEFAULT_CONFIDENCE_THRESHOLD = 12;
export const DEFAULT_SAMPLING_WORLD_COUNT = 8;
export const DEFAULT_SAMPLING_MAX_CANDIDATES = 12;
export const DEFAULT_SAMPLING_MAX_MS = 30;
