import { createHash } from "node:crypto";
import type { CardColor, CardPlacePayload, GameRoom, HintDecidePayload, SeatId, TurnView } from "@take-time/shared";
import type { AgentOrchestrator, FallbackReason, TurnDecision } from "./orchestrator.js";
import { ModelRequestCancelledError } from "./orchestrator.js";
import { abortModelRequest, modelAbortReason, type ModelAbortReason } from "./modelAbort.js";
import type { AttemptMemoryStore } from "./memory/attemptMemoryStore.js";
import { agentTelemetry, type AgentTelemetry } from "./telemetry.js";
import { buildTurnView } from "./views.js";
import { decideSafePlacement, isPlacementProvablyLosing } from "./safePolicy.js";
import { generateCandidates } from "./candidates/index.js";
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  type CandidateResult,
  type ScoredCandidate
} from "./candidates/types.js";
import { decideHintFromPolicy } from "./strategy/interpreters.js";
import { decideHintFromBelief } from "./belief/valueBelief.js";

interface CachedRevealIntent {
  attemptId: string;
  phaseVersion: number;
  cardId: string;
  intent: "yes" | "no";
  source: "model" | "default_no" | "hint_policy" | "belief_signal";
}

type TurnSelectionSource =
  | "model"
  | "candidate_top1"
  | "candidate_confidence"
  | "candidate_fallback"
  | "safe_policy";

interface CoordinatedTurnDecision extends Omit<TurnDecision, "source"> {
  source: "model" | "candidate" | "fallback";
  selectionSource: TurnSelectionSource;
  hintDecisionSource: "model" | "default_no" | "hint_policy" | "belief_signal";
}

export interface TurnCoordinatorOptions {
  // 模型 deadline 比游戏 deadline（thinkSeconds）提前的安全余量。
  // 这段时间不是纯保险，而是留给降级阶梯自己算：L1 重试窗口 + L3 规则安全策略的计算时间。
  // L3 是纯同步计算（几十毫秒），但必须显式预留，否则模型跑满预算后兜底自己就超时了。
  deadlineSafetyMs?: number;
  // 极短 thinkSeconds 下保底的模型预算，避免出现 0/负超时。
  minModelBudgetMs?: number;
  // 即使房间给出更长回合，单次出牌模型也不应无限占用玩家等待时间。
  maxModelBudgetMs?: number;
  // 某座位连续降级达到该次数后，本 attempt 不再调用模型，直接走规则安全策略。
  // 防止 Provider 挂掉后每一手都白等满 deadline，同时省下调用预算。
  maxConsecutiveFallbacks?: number;
  // M9.3 Slice 1 flags：候选主路径需先过 eval，默认由 runtime/env 决定是否开启。
  candidateEngineEnabled?: boolean;
  // true：低置信时让模型从 top-K 选；false：纯代码 candidate-top1 基线。
  modelTopKOnly?: boolean;
  candidateConfidenceThreshold?: number;
  hiddenSamplingEnabled?: boolean;
  samplingWorldCount?: number;
  samplingMaxCandidates?: number;
  samplingMaxMs?: number;
  // runtime 根据是否实际配置 Provider 注入；false 时不做注定失败的模型调用。
  modelAvailable?: boolean;
  // AI 落子节奏与模型 deadline 分离：模型可以尽早完成，但通常等到回合窗口
  // 的中段再展示落子；模型本身已经思考够久时不再额外等待。
  pacing?: {
    enabled?: boolean;
    minVisibleThinkMs?: number;
    maxVisibleThinkMs?: number;
    minFraction?: number;
    maxFraction?: number;
    random?: () => number;
    delay?: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  telemetry?: AgentTelemetry;
  memory?: AttemptMemoryStore;
}

// 10 秒回合把模型硬截止设为 7.5 秒：余下 2.5 秒覆盖 race 随机延迟、
// 规则兜底、状态写入和网络广播，实际落子应稳定落在 5–8 秒窗口内。
const DEFAULT_DEADLINE_SAFETY_MS = 2_500;
const DEFAULT_MIN_MODEL_BUDGET_MS = 1_500;
const DEFAULT_MAX_MODEL_BUDGET_MS = 10_000;
const DEFAULT_MAX_CONSECUTIVE_FALLBACKS = 3;
const DEFAULT_MIN_VISIBLE_THINK_MS = 5_000;
const DEFAULT_MAX_VISIBLE_THINK_MS = 10_000;
const DEFAULT_MIN_THINK_FRACTION = 0.5;
const DEFAULT_MAX_THINK_FRACTION = 0.65;

const candidateSetHash = (result: CandidateResult): string =>
  createHash("sha256")
    .update(JSON.stringify(result.ranked.map(({ cardId, segment, score }) => ({ cardId, segment, score }))))
    .digest("hex")
    .slice(0, 16);

export const isCandidateTop1Confident = (result: CandidateResult, threshold: number): boolean => {
  const first = result.ranked[0];
  const second = result.ranked[1];
  if (!first) return false;
  if (!second) return true;
  return first.score - second.score >= Math.max(0, threshold);
};

const candidateOf = (result: CandidateResult, cardId: string, segment: number): ScoredCandidate | undefined =>
  result.ranked.find((candidate) => candidate.cardId === cardId && candidate.segment === segment);

const candidateTurnDecision = (
  result: CandidateResult,
  selectionSource: Exclude<TurnSelectionSource, "model" | "safe_policy">,
  fallbackReason?: FallbackReason
): CoordinatedTurnDecision => {
  const first = result.ranked[0]!;
  return {
    cardId: first.cardId,
    segment: first.segment,
    revealIntent: "no" as const,
    appliedStrategyRuleIds: [...first.appliedRuleIds],
    relaxedStrategyRuleIds: [...result.relaxedRuleIds],
    source: fallbackReason ? ("fallback" as const) : ("candidate" as const),
    ...(fallbackReason ? { fallbackReason } : {}),
    selectionSource,
    hintDecisionSource: "default_no" as const
  };
};

// 熔断打开时的决策：跳过模型，直接用规则安全策略。
// revealIntent 固定为 no——降级中的 Agent 不替全队消耗共享的提示标记。
const degradedTurnDecision = (
  view: TurnView,
  fallbackReason: FallbackReason = "provider_error"
): CoordinatedTurnDecision => {
  const placement = decideSafePlacement(view);
  return {
    cardId: placement.cardId,
    segment: placement.segment,
    revealIntent: "no" as const,
    appliedStrategyRuleIds: [] as string[],
    relaxedStrategyRuleIds: [] as string[],
    source: "fallback" as const,
    fallbackReason,
    selectionSource: "safe_policy" as const,
    hintDecisionSource: "default_no" as const
  };
};

// placement 与 hint 合并为一次 TurnDecision：先落子，进入 hint 窗口后
// 消费缓存的 revealIntent，不再发起第二次模型调用（M9.2 第 4/5 条）。
// 规则保证剩余盲牌在 hint 结算之后才翻开，因此缓存的意图不会因盲牌解锁过期。
export class TurnCoordinator {
  private readonly pendingReveal = new Map<SeatId, CachedRevealIntent>();
  private readonly activeRequests = new Map<SeatId, Set<AbortController>>();
  private readonly pendingDecision = new Map<
    SeatId,
    {
      attemptId: string;
      phaseVersion: number;
      turnVersion: number;
      cardId: string;
      segment: number;
      source: "model" | "candidate" | "fallback";
      fallbackReason?: string;
      selectionSource: TurnSelectionSource;
      candidateSetHash?: string;
      evaluatorVersion?: string;
      samplingVersion?: string;
      samplingWorlds?: number;
      samplingEvaluations?: number;
      samplingBudgetExceeded?: boolean;
      candidateComputeMs?: number;
      hintDecisionSource: "model" | "default_no" | "hint_policy" | "belief_signal";
      appliedStrategyRuleIds: string[];
      relaxedStrategyRuleIds: string[];
      knownCard?: { value: number; color: CardColor };
      startedAt: number;
      levelId?: string;
      playerCount: number;
    }
  >();
  private readonly telemetry: AgentTelemetry;
  // 熔断状态按 attempt 归属：换一局或重试本关都重新给模型机会。
  private breakerAttemptId: string | null = null;
  private readonly consecutiveFallbacks = new Map<SeatId, number>();

  constructor(
    private readonly orchestrator: AgentOrchestrator,
    private readonly options: TurnCoordinatorOptions = {}
  ) {
    this.telemetry = options.telemetry ?? agentTelemetry;
  }

  private syncBreakerAttempt(attemptId: string) {
    if (this.breakerAttemptId === attemptId) return;
    this.breakerAttemptId = attemptId;
    this.consecutiveFallbacks.clear();
  }

  private isBreakerOpen(seatId: SeatId): boolean {
    const limit = this.options.maxConsecutiveFallbacks ?? DEFAULT_MAX_CONSECUTIVE_FALLBACKS;
    return (this.consecutiveFallbacks.get(seatId) ?? 0) >= limit;
  }

  // 模型成功一次即完全恢复；降级一次推进熔断计数。
  private recordDecisionSource(seatId: SeatId, source: "model" | "candidate" | "fallback") {
    if (source === "model") {
      this.consecutiveFallbacks.delete(seatId);
      return;
    }
    if (source === "candidate") return;
    this.consecutiveFallbacks.set(seatId, (this.consecutiveFallbacks.get(seatId) ?? 0) + 1);
  }

  // 诊断/测试入口：观察某座位当前的连续降级次数。
  consecutiveFallbacksOf(seatId: SeatId): number {
    return this.consecutiveFallbacks.get(seatId) ?? 0;
  }

  private pacingTargetMs(room: GameRoom): number {
    const pacing = this.options.pacing;
    if (pacing?.enabled === false) return 0;

    const thinkWindowMs = room.settings.thinkSeconds * 1_000;
    const latestSafePlacementMs = this.modelBudgetMs(room);
    const minFraction = Math.max(0, pacing?.minFraction ?? DEFAULT_MIN_THINK_FRACTION);
    const maxFraction = Math.max(minFraction, pacing?.maxFraction ?? DEFAULT_MAX_THINK_FRACTION);
    const random = Math.min(1, Math.max(0, (pacing?.random ?? Math.random)()));
    const fraction = minFraction + (maxFraction - minFraction) * random;
    const targetMs = Math.max(
      pacing?.minVisibleThinkMs ?? DEFAULT_MIN_VISIBLE_THINK_MS,
      Math.round(thinkWindowMs * fraction)
    );
    return Math.min(
      latestSafePlacementMs,
      pacing?.maxVisibleThinkMs ?? DEFAULT_MAX_VISIBLE_THINK_MS,
      targetMs
    );
  }

  private modelBudgetMs(room: GameRoom): number {
    const minBudgetMs = this.options.minModelBudgetMs ?? DEFAULT_MIN_MODEL_BUDGET_MS;
    const maxBudgetMs = Math.max(minBudgetMs, this.options.maxModelBudgetMs ?? DEFAULT_MAX_MODEL_BUDGET_MS);
    const roomBudgetMs = Math.max(
      room.settings.thinkSeconds * 1_000 - (this.options.deadlineSafetyMs ?? DEFAULT_DEADLINE_SAFETY_MS),
      minBudgetMs
    );
    return Math.min(roomBudgetMs, maxBudgetMs);
  }

  // AbortController 负责真正取消 Provider；本地 abort gate 同时保证即使某个
  // SDK/上游没有及时兑现取消，房间也会在硬截止立即转入安全策略，不继续空等。
  private async decideTurnWithinBudget(
    view: TurnView,
    controller: AbortController,
    budgetMs: number,
    candidates?: CandidateResult
  ): Promise<CoordinatedTurnDecision> {
    type Outcome =
      | { kind: "decision"; decision: Awaited<ReturnType<AgentOrchestrator["decideTurn"]>> }
      | { kind: "error"; error: unknown }
      | { kind: "aborted"; reason: ModelAbortReason };

    let onAbort = () => {};
    const abortGate = new Promise<Outcome>((resolve) => {
      onAbort = () => resolve({ kind: "aborted", reason: modelAbortReason(controller.signal) ?? "phase_changed" });
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
    const decision: Promise<Outcome> = this.orchestrator
      .decideTurn(view, {
        signal: controller.signal,
        ...(candidates
          ? { candidates: { evaluatorVersion: candidates.evaluatorVersion, topK: candidates.topK } }
          : {})
      })
      .then((result): Outcome => ({ kind: "decision", decision: result }))
      .catch((error: unknown): Outcome => ({ kind: "error", error }));
    const deadlineTimer = setTimeout(() => abortModelRequest(controller, "deadline"), budgetMs);

    try {
      const outcome = await Promise.race([decision, abortGate]);
      if (outcome.kind === "decision") {
        return {
          ...outcome.decision,
          selectionSource: outcome.decision.source === "model" ? "model" : "safe_policy",
          hintDecisionSource: outcome.decision.source === "model" ? "model" : "default_no"
        };
      }
      if (outcome.kind === "error") throw outcome.error;
      if (outcome.reason === "deadline") {
        return candidates
          ? candidateTurnDecision(candidates, "candidate_fallback", "timeout")
          : degradedTurnDecision(view, "timeout");
      }
      throw new ModelRequestCancelledError();
    } finally {
      clearTimeout(deadlineTimer);
      controller.signal.removeEventListener("abort", onAbort);
    }
  }

  private async waitForPacing(startedAt: number, targetMs: number, controller: AbortController): Promise<boolean> {
    const remainingMs = targetMs - (Date.now() - startedAt);
    if (remainingMs <= 0) return !controller.signal.aborted;

    const customDelay = this.options.pacing?.delay;
    if (customDelay) {
      try {
        await customDelay(remainingMs, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return false;
        throw error;
      }
      return !controller.signal.aborted;
    }

    return new Promise<boolean>((resolve) => {
      const finish = (completed: boolean) => {
        clearTimeout(timer);
        controller.signal.removeEventListener("abort", onAbort);
        resolve(completed);
      };
      const onAbort = () => finish(false);
      const timer = setTimeout(() => finish(true), remainingMs);
      controller.signal.addEventListener("abort", onAbort, { once: true });
      if (controller.signal.aborted) onAbort();
    });
  }

  // attempt/phase/turn 改变（超时判负、返回选关、结束对局）时取消在途请求；
  // 旧响应不得落子或写缓存（M9.2 第 10 条）。
  cancelAll(reason: ModelAbortReason = "phase_changed") {
    for (const seatId of new Set<SeatId>([
      ...this.activeRequests.keys(),
      ...this.pendingReveal.keys(),
      ...this.pendingDecision.keys()
    ])) {
      this.cancelSeat(seatId, reason);
    }
  }

  // race 中某座位（真人或 Agent）先落子后，只取消其他座位的请求；
  // 获胜 Agent 的 revealIntent 必须保留到紧随其后的 hint 窗口。
  cancelOtherSeats(winnerSeatId: SeatId, reason: ModelAbortReason = "turn_changed") {
    for (const seatId of new Set<SeatId>([
      ...this.activeRequests.keys(),
      ...this.pendingReveal.keys(),
      ...this.pendingDecision.keys()
    ])) {
      if (seatId !== winnerSeatId) this.cancelSeat(seatId, reason);
    }
  }

  private cancelSeat(seatId: SeatId, reason: ModelAbortReason) {
    for (const controller of this.activeRequests.get(seatId) ?? []) abortModelRequest(controller, reason);
    this.activeRequests.delete(seatId);
    this.pendingReveal.delete(seatId);

    const pending = this.pendingDecision.get(seatId);
    if (pending) {
      this.telemetry.recordTurnDecision({
        seatId,
        attemptId: pending.attemptId,
        phaseVersion: pending.phaseVersion,
        turnVersion: pending.turnVersion,
        levelId: pending.levelId,
        playerCount: pending.playerCount,
        source: "cancelled",
        selectionSource: pending.selectionSource,
        candidateSetHash: pending.candidateSetHash,
        evaluatorVersion: pending.evaluatorVersion,
        hintDecisionSource: pending.hintDecisionSource,
        decisionEndToEndLatencyMs: Date.now() - pending.startedAt
      });
    }
    this.pendingDecision.delete(seatId);
  }

  // 轮到本座位时的出牌决策。房间状态在 await 期间被推进（stale）时返回 null，
  // 调用方不得使用任何结果——由 handoff 的版本校验二次兜底。
  async decidePlacement(room: GameRoom, seatId: SeatId): Promise<CardPlacePayload | null> {
    // handoff 会做同样的资格仲裁；这里保留独立的入口防线，确保延迟 race
    // 输家、hint 窗口或其他座位回合不会启动正式模型请求。
    if (
      room.phase !== "placing" ||
      room.pendingHint ||
      (room.turn !== "race" && room.turn !== seatId)
    ) {
      return null;
    }
    const startedAt = Date.now();
    const pacingTargetMs = this.pacingTargetMs(room);
    const view = buildTurnView(room, seatId, this.options.memory);
    // 每回合只生成一次，后续 prompt、硬边界、兜底与 telemetry 共用同一快照。
    const candidates = this.options.candidateEngineEnabled
      ? generateCandidates(view, {
          sampling: {
            enabled: this.options.hiddenSamplingEnabled ?? false,
            seed: `${view.attemptId}:${view.turnVersion}:${seatId}`,
            ...(this.options.samplingWorldCount !== undefined
              ? { worldCount: this.options.samplingWorldCount }
              : {}),
            ...(this.options.samplingMaxCandidates !== undefined
              ? { maxCandidates: this.options.samplingMaxCandidates }
              : {}),
            ...(this.options.samplingMaxMs !== undefined ? { maxMs: this.options.samplingMaxMs } : {})
          }
        })
      : undefined;
    const candidatesHash = candidates ? candidateSetHash(candidates) : undefined;
    const token = {
      attemptId: view.attemptId,
      phaseVersion: view.phaseVersion,
      turnVersion: view.turnVersion
    };

    const modelController = new AbortController();
    const pacingController = new AbortController();
    const seatRequests = this.activeRequests.get(seatId) ?? new Set<AbortController>();
    seatRequests.add(modelController);
    seatRequests.add(pacingController);
    this.activeRequests.set(seatId, seatRequests);
    const modelBudgetMs = this.modelBudgetMs(room);

    this.syncBreakerAttempt(view.attemptId);

    try {
      let decision: CoordinatedTurnDecision;
      try {
        const top1Confident = candidates
          ? isCandidateTop1Confident(
              candidates,
              this.options.candidateConfidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD
            )
          : false;
        // 熔断打开时跳过模型调用，直接走候选 #1（未启用候选时才退回 safePolicy）。
        // Provider 已经连续失败，再等满 deadline 只是浪费回合时间和预算。
        if (this.isBreakerOpen(seatId)) {
          decision = candidates
            ? candidateTurnDecision(candidates, "candidate_fallback", "provider_error")
            : degradedTurnDecision(view);
        } else if (
          candidates &&
          (this.options.modelTopKOnly === false || this.options.modelAvailable === false)
        ) {
          decision = candidateTurnDecision(candidates, "candidate_top1");
        } else if (candidates && top1Confident) {
          decision = candidateTurnDecision(candidates, "candidate_confidence");
        } else {
          decision = await this.decideTurnWithinBudget(view, modelController, modelBudgetMs, candidates);
        }
      } catch (error) {
        if (!(error instanceof ModelRequestCancelledError)) throw error;
        this.telemetry.recordTurnDecision({
          seatId,
          attemptId: token.attemptId,
          phaseVersion: token.phaseVersion,
          turnVersion: token.turnVersion,
          levelId: view.level?.id,
          playerCount: view.seats.length,
          source: "cancelled",
          decisionEndToEndLatencyMs: Date.now() - startedAt
        });
        return null;
      }

      if (candidates) {
        if (decision.source === "fallback") {
          // Provider/预算/格式失败时，丢弃 orchestrator 内部的旧 safePolicy 结果，
          // 统一使用本回合已生成的候选 #1。
          decision = candidateTurnDecision(
            candidates,
            "candidate_fallback",
            decision.fallbackReason ?? "provider_error"
          );
        } else if (decision.source === "model") {
          const selected = candidateOf(candidates, decision.cardId, decision.segment);
          const inTopK = candidates.topK.some(
            (candidate) => candidate.cardId === decision.cardId && candidate.segment === decision.segment
          );
          if (!selected || !inTopK) {
            decision = candidateTurnDecision(candidates, "candidate_fallback", "illegal_output");
          } else {
            // 结构化规则处置由确定性候选层认定，不能让模型自报遵守/放宽。
            decision = {
              ...decision,
              appliedStrategyRuleIds: [...selected.appliedRuleIds],
              relaxedStrategyRuleIds: [...candidates.relaxedRuleIds],
              selectionSource: "model",
              hintDecisionSource: "model"
            };
          }
        }
      }

      // Provider/预算/非法输出等 fallback 必须保持 revealIntent=no，不能在
      // 降级完成后又被 hint_policy 或 belief_signal 改回 yes、消耗共享标记。
      if (decision.source !== "fallback") {
        const hintPolicy = decideHintFromPolicy(view, decision.cardId);
        if (hintPolicy) {
          decision = {
            ...decision,
            revealIntent: hintPolicy.intent,
            appliedStrategyRuleIds: [
              ...new Set([...decision.appliedStrategyRuleIds, ...hintPolicy.appliedRuleIds])
            ],
            hintDecisionSource: "hint_policy"
          };
        } else {
          const beliefIntent = decideHintFromBelief(view, decision.cardId, decision.segment);
          if (beliefIntent === "yes") {
            decision = {
              ...decision,
              revealIntent: "yes",
              hintDecisionSource: "belief_signal"
            };
          }
        }
      }

      // 最小安全护栏（2026-07-21 findings P0-2）：模型正常返回、但该动作已可
      // 从可见信息严格证明必输时，替换为规则安全候选。模型本身工作正常，
      // 不推进熔断计数（source 保持 model），只在 telemetry 里标注护栏原因。
      // revealIntent 归 no：被替换的牌不是模型想公开的那张，不替全队烧标记。
      let guardReason: string | undefined;
      if (decision.source === "model" && isPlacementProvablyLosing(view, decision.cardId, decision.segment)) {
        const safe = decideSafePlacement(view);
        console.warn(
          JSON.stringify({
            event: "agent:model_move_guarded",
            seatId,
            attemptId: token.attemptId,
            rejected: { cardId: decision.cardId, segment: decision.segment },
            replacement: safe
          })
        );
        guardReason = "guard_provably_losing";
        decision = {
          ...decision,
          cardId: safe.cardId,
          segment: safe.segment,
          revealIntent: "no",
          appliedStrategyRuleIds: [],
          relaxedStrategyRuleIds: [],
          selectionSource: candidates ? "candidate_fallback" : "safe_policy",
          hintDecisionSource: "default_no"
        };
      }

      this.recordDecisionSource(seatId, decision.source);
      if (decision.source === "fallback") {
        // 出牌阶段对玩家静默降级：只写结构化日志，不改任何可见状态。
        // 前提是 L3 足够可靠——见 safePolicy.ts 与 tests/safePolicy.test.ts。
        console.warn(
          JSON.stringify({
            event: "agent:turn_degraded",
            seatId,
            attemptId: token.attemptId,
            layer: this.isBreakerOpen(seatId)
              ? "breaker_open"
              : candidates
                ? "candidate_first"
                : "safe_policy",
            reason: decision.fallbackReason ?? "breaker_open",
            consecutiveFallbacks: this.consecutiveFallbacksOf(seatId)
          })
        );
      }

      const isStale = () =>
        room.identity.attemptId !== token.attemptId ||
        room.phase !== "placing" ||
        room.phaseVersion !== token.phaseVersion ||
        room.turnVersion !== token.turnVersion ||
        Boolean(room.pendingHint) ||
        (room.turn !== "race" && room.turn !== seatId);

      if (isStale()) {
        this.telemetry.recordTurnDecision({
          seatId,
          attemptId: token.attemptId,
          phaseVersion: token.phaseVersion,
          turnVersion: token.turnVersion,
          levelId: view.level?.id,
          playerCount: view.seats.length,
          source: "cancelled",
          decisionEndToEndLatencyMs: Date.now() - startedAt
        });
        return null;
      }

      if (!(await this.waitForPacing(startedAt, pacingTargetMs, pacingController)) || isStale()) {
        this.telemetry.recordTurnDecision({
          seatId,
          attemptId: token.attemptId,
          phaseVersion: token.phaseVersion,
          turnVersion: token.turnVersion,
          levelId: view.level?.id,
          playerCount: view.seats.length,
          source: "cancelled",
          decisionEndToEndLatencyMs: Date.now() - startedAt
        });
        return null;
      }

      this.pendingReveal.set(seatId, {
        attemptId: token.attemptId,
        // applyPlacement 打开 hint 窗口时会自增 turnVersion，
        // 因此缓存按 attempt + phaseVersion + cardId 校验。
        phaseVersion: token.phaseVersion,
        cardId: decision.cardId,
        intent: decision.revealIntent,
        source: decision.hintDecisionSource
      });
      this.pendingDecision.set(seatId, {
        ...token,
        cardId: decision.cardId,
        segment: decision.segment,
        source: decision.source,
        fallbackReason: guardReason ?? decision.fallbackReason,
        selectionSource: decision.selectionSource,
        candidateSetHash: candidatesHash,
        evaluatorVersion: candidates?.evaluatorVersion,
        samplingVersion: candidates?.sampling?.version,
        samplingWorlds: candidates?.sampling?.generatedWorlds,
        samplingEvaluations: candidates?.sampling?.evaluations,
        samplingBudgetExceeded: candidates?.sampling?.budgetExceeded,
        candidateComputeMs: candidates?.sampling?.elapsedMs,
        hintDecisionSource: decision.hintDecisionSource,
        appliedStrategyRuleIds: [...decision.appliedStrategyRuleIds],
        relaxedStrategyRuleIds: [...decision.relaxedStrategyRuleIds],
        ...(() => {
          const selected = view.hand.find((card) => card.id === decision.cardId);
          return typeof selected?.value === "number" && selected.color
            ? { knownCard: { value: selected.value, color: selected.color } }
            : {};
        })(),
        startedAt,
        levelId: view.level?.id,
        playerCount: view.seats.length
      });
      return { cardId: decision.cardId, segment: decision.segment };
    } finally {
      const active = this.activeRequests.get(seatId);
      active?.delete(modelController);
      active?.delete(pacingController);
      if (active?.size === 0) this.activeRequests.delete(seatId);
    }
  }

  // 由动作层在 applyPlacement 成功后调用；至此才结束 end-to-end 延迟计时。
  completePlacement(room: GameRoom, seatId: SeatId, cardId: string, segment: number) {
    const pending = this.pendingDecision.get(seatId);
    if (!pending) return null;
    this.pendingDecision.delete(seatId);
    if (
      pending.attemptId !== room.identity.attemptId ||
      pending.phaseVersion !== room.phaseVersion ||
      pending.cardId !== cardId ||
      pending.segment !== segment
    ) {
      this.telemetry.recordTurnDecision({
        seatId,
        attemptId: pending.attemptId,
        phaseVersion: pending.phaseVersion,
        turnVersion: pending.turnVersion,
        levelId: pending.levelId,
        playerCount: pending.playerCount,
        source: "fallback",
        fallbackReason: "illegal_output",
        selectionSource: pending.selectionSource,
        candidateSetHash: pending.candidateSetHash,
        evaluatorVersion: pending.evaluatorVersion,
        hintDecisionSource: "default_no",
        appliedStrategyRuleIds: [],
        relaxedStrategyRuleIds: [],
        decisionEndToEndLatencyMs: Date.now() - pending.startedAt
      });
      return null;
    }
    this.telemetry.recordTurnDecision({
      seatId,
      attemptId: pending.attemptId,
      phaseVersion: pending.phaseVersion,
      turnVersion: pending.turnVersion,
      levelId: pending.levelId,
      playerCount: pending.playerCount,
      source: pending.source,
      fallbackReason: pending.fallbackReason,
      selectionSource: pending.selectionSource,
      candidateSetHash: pending.candidateSetHash,
      evaluatorVersion: pending.evaluatorVersion,
      samplingVersion: pending.samplingVersion,
      samplingWorlds: pending.samplingWorlds,
      samplingEvaluations: pending.samplingEvaluations,
      samplingBudgetExceeded: pending.samplingBudgetExceeded,
      candidateComputeMs: pending.candidateComputeMs,
      hintDecisionSource: pending.hintDecisionSource,
      appliedStrategyRuleIds: [...pending.appliedStrategyRuleIds],
      relaxedStrategyRuleIds: [...pending.relaxedStrategyRuleIds],
      decisionEndToEndLatencyMs: Date.now() - pending.startedAt
    });
    return {
      source: pending.source,
      fallbackReason: pending.fallbackReason,
      appliedStrategyRuleIds: [...pending.appliedStrategyRuleIds],
      relaxedStrategyRuleIds: [...pending.relaxedStrategyRuleIds],
      ...(pending.knownCard ? { knownCard: { ...pending.knownCard } } : {})
    };
  }

  // hint 窗口：消费缓存的 revealIntent，一次性使用；缓存缺失、
  // 版本不匹配或窗口不是本次落子的牌时按 no 处理。
  decideHint(room: GameRoom, seatId: SeatId): HintDecidePayload["decision"] {
    const cached = this.pendingReveal.get(seatId);
    this.pendingReveal.delete(seatId);

    const pending = room.pendingHint;
    if (!cached || !pending || pending.seatId !== seatId) return "no";
    if (cached.attemptId !== room.identity.attemptId) return "no";
    if (cached.phaseVersion !== room.phaseVersion) return "no";
    if (cached.cardId !== pending.cardId) return "no";
    return cached.intent;
  }
}
