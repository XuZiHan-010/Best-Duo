import {
  handSizeForPlayerCount,
  type ChatMessage,
  type Condition,
  type GameRoom,
  type HintDecidePayload,
  type PlacedCard,
  type PlayerCount,
  type SeatId
} from "@take-time/shared";
import { appendChatMessage } from "../game/chat.js";
import { findSeat } from "../game/room.js";
import { DiscussionCoordinator } from "./discussionCoordinator.js";
import { ingestEntityCandidates } from "./entities.js";
import { AttemptMemoryStore } from "./memory/attemptMemoryStore.js";
import { recordRoomObservation } from "./memory/recorders.js";
import type { RetryBrief } from "./memory/types.js";
import {
  AgentOrchestrator,
  CURRENT_DISCUSSION_MESSAGE_SOURCE,
  type DiscussionEntityCandidate
} from "./orchestrator.js";
import { AgentStrategyPlanner } from "./strategyPlanner.js";
import { buildPublicFactsFallback } from "./strategyFallback.js";
import { buildDiscussionView } from "./views.js";
import { UnconfiguredModelClient, type ModelClient } from "./modelClient.js";
import { BudgetedModelClient, ModelCallBudget } from "./budget.js";
import { createModelSeatAgent } from "./modelAgent.js";
import type { PlayerAgent } from "./PlayerAgent.js";
import { loadAgentProviderConfig, maxOutputTokensFor } from "./providerConfig.js";
import { createModelClientFromConfig } from "./providers.js";
import type { AgentTelemetry } from "./telemetry.js";
import { TurnCoordinator, type TurnCoordinatorOptions } from "./turnCoordinator.js";
import { abortModelRequest, type ModelAbortReason } from "./modelAbort.js";
import { DiscussionInputGuard, type MetaReplyContext } from "./discussionGuard.js";
import { loadCandidateRuntimeConfig } from "./candidates/config.js";
import { compilePublicContract, contractRulesForSeat } from "./contract/compile.js";

export interface AgentRuntimeOptions {
  modelClient?: ModelClient;
  telemetry?: AgentTelemetry;
  discussion?: {
    maxMessagesPerAgent?: number;
    cooldownMs?: number;
    delay?: (ms: number) => Promise<void>;
    requestDeadlineMs?: number;
  };
  turn?: Pick<
    TurnCoordinatorOptions,
    | "deadlineSafetyMs"
    | "minModelBudgetMs"
    | "maxModelBudgetMs"
    | "pacing"
    | "candidateEngineEnabled"
    | "modelTopKOnly"
    | "candidateConfidenceThreshold"
    | "hiddenSamplingEnabled"
    | "samplingWorldCount"
    | "samplingMaxCandidates"
    | "samplingMaxMs"
  >;
  strategyDeadlineMs?: number;
  retryBriefDeadlineMs?: number;
}

// 默认 client：按 env 路由 OpenAI / DeepSeek 并套预算；
// 一个任务都没配置 key 时退回 UnconfiguredModelClient（Agent 沉默 + 脚本兜底）。
const buildDefaultModelClient = (): ModelClient => {
  const fromEnv = createModelClientFromConfig(loadAgentProviderConfig());
  if (!fromEnv) return new UnconfiguredModelClient();
  return fromEnv;
};

// 出牌预留的重试冗余系数：L1 每张牌最多重试一次，最坏 2 次调用。
const TURN_RETRY_HEADROOM = 2;

// 按 condition type 显式归属失败区段：无区段字段的全局条件
// （all-nonempty / max-sum-each）用揭示结果的牌数/总和定位（ACR-05）。
const failedSegmentsOf = (room: GameRoom): number[] => {
  const revealResult = room.revealResult;
  if (!revealResult) return [];

  const failed = new Set<number>();
  for (const result of revealResult.conditions) {
    if (result.pass) continue;
    const condition = result.condition as Condition;
    switch (condition.type) {
      case "all-nonempty":
        revealResult.segmentCounts.forEach((count, segment) => {
          if (count === 0) failed.add(segment);
        });
        break;
      case "max-sum-each":
        revealResult.segmentSums.forEach((sum, segment) => {
          if (sum > condition.value) failed.add(segment);
        });
        break;
      case "non-decreasing":
      case "non-increasing":
        for (const segment of condition.segments) failed.add(segment);
        break;
      case "adjacent-diff":
        failed.add(condition.a);
        failed.add(condition.b);
        break;
      default:
        failed.add(condition.segment);
        break;
    }
  }
  return [...failed].sort((left, right) => left - right);
};

export class AgentRuntime {
  readonly memory = new AttemptMemoryStore();
  private readonly orchestrator: AgentOrchestrator;
  private readonly planner: AgentStrategyPlanner;
  private readonly discussionOptions: AgentRuntimeOptions["discussion"];
  private readonly budget = new ModelCallBudget(loadAgentProviderConfig().budget);
  private readonly turnCoordinator: TurnCoordinator;
  private readonly discussionGuard = new DiscussionInputGuard();
  private coordinator: DiscussionCoordinator | null = null;
  private readonly managedRequests = new Set<AbortController>();
  private readonly strategyDeadlineMs: number;
  private readonly retryBriefDeadlineMs: number;

  constructor(options: AgentRuntimeOptions = {}) {
    // 无论真实 Provider 还是测试/自定义注入，都统一经过预算装饰器；生产链路不存在绕过入口。
    const rawModelClient = options.modelClient ?? buildDefaultModelClient();
    const modelClient = new BudgetedModelClient(rawModelClient, this.budget);
    this.orchestrator = new AgentOrchestrator({ modelClient, telemetry: options.telemetry });
    this.planner = new AgentStrategyPlanner({ modelClient, telemetry: options.telemetry });
    this.discussionOptions = options.discussion;
    const candidateConfig = loadCandidateRuntimeConfig();
    const turnOptions: TurnCoordinatorOptions = {
      ...options.turn,
      candidateEngineEnabled: options.turn?.candidateEngineEnabled ?? candidateConfig.candidateEngineEnabled,
      modelTopKOnly: options.turn?.modelTopKOnly ?? candidateConfig.modelTopKOnly,
      candidateConfidenceThreshold:
        options.turn?.candidateConfidenceThreshold ?? candidateConfig.candidateConfidenceThreshold,
      hiddenSamplingEnabled: options.turn?.hiddenSamplingEnabled ?? candidateConfig.hiddenSamplingEnabled,
      samplingWorldCount: options.turn?.samplingWorldCount ?? candidateConfig.samplingWorldCount,
      samplingMaxCandidates: options.turn?.samplingMaxCandidates ?? candidateConfig.samplingMaxCandidates,
      samplingMaxMs: options.turn?.samplingMaxMs ?? candidateConfig.samplingMaxMs,
      modelAvailable: !(rawModelClient instanceof UnconfiguredModelClient),
      // 自动化测试验证状态机与契约，不应为真人可见节奏实际等待数秒；
      // 节奏本身由 TurnCoordinator 的专门测试显式开启并覆盖。
      pacing: options.turn?.pacing ?? (process.env.NODE_ENV === "test" ? { enabled: false } : undefined),
      telemetry: options.telemetry,
      memory: this.memory
    };
    this.turnCoordinator = new TurnCoordinator(this.orchestrator, turnOptions);
    // 收口阻塞 discussion → placing 转换，玩家在"整理讨论策略"里等的就是它：
    // 8s 硬截止（2026-07-21 findings P0-1），超时走公开事实兜底策略而非空策略，
    // 不再让玩家等满 gpt-5.4 low 实测的 5-14s 长尾。
    this.strategyDeadlineMs = options.strategyDeadlineMs ?? 8_000;
    // RetryBrief 是结算后的后台任务，无人等待；flash 真实规模输入实测 7-10s，10s 会间歇撞线。
    this.retryBriefDeadlineMs = options.retryBriefDeadlineMs ?? 30_000;
  }

  // HostAddAgent 时为座位创建模型 Agent：出牌 + hint 消费同一次 TurnDecision，
  // 未配置 Provider 时 orchestrator 自动走启发式兜底（与脚本 Agent 行为一致）。
  createSeatAgent(room: GameRoom, seatId: SeatId): PlayerAgent {
    return createModelSeatAgent(room, seatId, this.turnCoordinator);
  }

  // 诊断/测试入口：观察某座位当前的无关问题退避阶梯。
  offTopicStrikesOf(seatId: SeatId): number {
    return this.discussionGuard.offTopicStrikesOf(seatId);
  }

  private agentSeatIds(room: GameRoom): SeatId[] {
    return room.seats.filter((seat) => seat.kind === "agent" && seat.nick).map((seat) => seat.id);
  }

  // 第 1 层元问题的本地模板需要真实上下文，避免回出“我是 AI 助手”式的空话。
  private metaReplyContext(room: GameRoom, agentSeatId: SeatId | undefined): MetaReplyContext {
    const seat = agentSeatId ? findSeat(room, agentSeatId) : undefined;
    return {
      nick: seat?.nick ?? "AI 队友",
      levelTitle: room.currentChallenge?.name ?? null
    };
  }

  private appendAgentDiscussionMessage(
    room: GameRoom,
    seatId: SeatId,
    text: string,
    entities?: DiscussionEntityCandidate[]
  ): ChatMessage {
    const seat = findSeat(room, seatId);
    const message = appendChatMessage(room, {
      senderSeatId: seatId,
      kind: "agent",
      nick: seat?.nick ?? seatId,
      text
    });
    this.recordPublicChat(room, message);
    if (entities?.length) this.ingestDiscussionEntities(room, seatId, entities, message.id);
    return message;
  }

  // 进入讨论：开新 attempt memory，重置 attempt 级模型预算，
  // 并为在座 Agent 启动发言调度。
  onDiscussionStarted(room: GameRoom, onAgentMessage?: () => void) {
    this.cancelDiscussion();
    room.agentState = { seats: [], review: null };

    const { campaignId, playSessionId, levelRunId, attemptId } = room.identity;
    const levelId = room.currentChallenge?.id;
    if (!levelRunId || !attemptId || !levelId) return;
    // 为本局 AI 出牌预留 turn 额度：Agent 座位数 × 每人手牌数（P1-1b）。
    // 讨论没有发言上限后，非 turn 任务不得吃进这部分预算——次数和 token 都要留。
    const occupied = room.seats.filter((seat) => Boolean(seat.nick)).length;
    const agentSeatCount = this.agentSeatIds(room).length;
    const baseTurnCalls =
      occupied >= 2 && occupied <= 4
        ? agentSeatCount * handSizeForPlayerCount(occupied as PlayerCount)
        : 0;
    // L1 每张牌最多重试一次 → 每张牌最坏 2 次调用；按最坏情况留冗余，
    // 宁可讨论早点闭嘴，也不让出牌因预算耗尽而盲打（2026-07-21 findings）。
    const reservedTurnCalls = baseTurnCalls * TURN_RETRY_HEADROOM;
    // 每次出牌 token 的保守上界：BudgetedModelClient 用字符数当 token 上界，
    // 这里用 turn 输出上限的 2 倍覆盖"输入 + 输出"，防止讨论把 token 聊穿。
    const reservedTurnTokens = reservedTurnCalls * maxOutputTokensFor("turn") * 2;
    this.budget.beginAttempt(attemptId, { reservedTurnCalls, reservedTurnTokens });
    this.discussionGuard.beginAttempt(attemptId);
    this.memory.beginAttempt({ campaignId, playSessionId, levelRunId, levelId, attemptId });
    this.recordPhaseChange(room);

    const speakers = this.agentSeatIds(room).map((seatId) => ({
      seatId,
      decideDiscussion: (
        view: Parameters<AgentOrchestrator["decideDiscussion"]>[0],
        options?: Parameters<AgentOrchestrator["decideDiscussion"]>[1]
      ) => this.orchestrator.decideDiscussion(view, options)
    }));
    if (speakers.length === 0) return;

    this.coordinator = new DiscussionCoordinator(room, speakers, {
      ...this.discussionOptions,
      memory: this.memory,
      excludedMessageIds: () => this.discussionGuard.excludedMessageIds(),
      waitForActivity: true,
      waitForInitialActivity: true,
      onMessage: (seatId, text, entities, verdict) => {
        // 模型判无关时，把这条真人消息和拒答本身一起移出后续所有模型上下文，
        // 并推进该座位的退避阶梯；判正常则让该座位完全恢复。
        const focus = verdict ? room.chat.find((message) => message.id === verdict.focusMessageId) : undefined;
        if (focus && verdict) this.discussionGuard.recordModelVerdict(focus.senderSeatId, verdict.topic);
        const appended = this.appendAgentDiscussionMessage(room, seatId, text, entities);
        if (verdict?.topic === "off_topic") {
          this.discussionGuard.excludeMessageId(verdict.focusMessageId);
          this.discussionGuard.excludeMessageId(appended.id);
        }
        onAgentMessage?.();
      },
      // 该座位讨论阶段彻底接不上模型：用第一人称、玩家语言说明一次，
      // 让真人不要误以为它已听到并同意方案。不给技术原因。
      onSpeakerExhausted: (seatId) => {
        const notice = this.appendAgentDiscussionMessage(
          room,
          seatId,
          "我这边暂时接不上，先按没有我的方案安排，我会跟着你们的约定走。"
        );
        // 该提示本身不是策略，排除出后续模型上下文。
        this.discussionGuard.excludeMessageId(notice.id);
        onAgentMessage?.();
      }
    });
    void this.coordinator.start().catch((error) => {
      console.warn(JSON.stringify({ event: "discussion:coordinator_failed", error: String(error) }));
    });
  }

  cancelDiscussion(reason: ModelAbortReason = "phase_changed") {
    this.coordinator?.cancel();
    this.coordinator = null;
    for (const controller of this.managedRequests) abortModelRequest(controller, reason);
    // attempt/阶段被推进（返回选关、结束对局、超时判负）时，
    // 在途的出牌模型请求一并取消，旧响应不得落子或写缓存。
    this.turnCoordinator.cancelAll(reason);
  }

  cancelTurnRequests(reason: ModelAbortReason = "turn_changed") {
    this.turnCoordinator.cancelAll(reason);
  }

  keepRaceWinner(winnerSeatId: SeatId) {
    this.turnCoordinator.cancelOtherSeats(winnerSeatId, "turn_changed");
  }

  recordPublicChat(room: GameRoom, message: ChatMessage) {
    if (message.kind === "human") {
      const agentSeatId = this.agentSeatIds(room)[0];
      const guardDecision = this.discussionGuard.evaluate(
        message,
        this.metaReplyContext(room, agentSeatId)
      );
      console.info(
        JSON.stringify({
          event: "discussion:guard_decision",
          seatId: message.senderSeatId,
          action: guardDecision.action,
          reason: guardDecision.action === "allow" ? null : guardDecision.reason,
          offTopicStrikes: this.discussionGuard.offTopicStrikesOf(message.senderSeatId)
        })
      );
      if (guardDecision.action !== "allow") {
        // local_reply 与 ignore 都不唤醒调度器：这条消息不会进入任何模型上下文。
        if (guardDecision.action === "local_reply" && agentSeatId) {
          const reply = this.appendAgentDiscussionMessage(room, agentSeatId, guardDecision.response);
          this.discussionGuard.excludeMessageId(reply.id);
        }
        return;
      }
    }

    const observation = recordRoomObservation(this.memory, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "chat",
      visibility: "public",
      sourceSeatId: message.senderSeatId,
      payload: { messageId: message.id, text: message.text }
    });
    if (observation && message.kind === "agent") {
      this.memory.recordOwnAction(message.senderSeatId, {
        kind: "chat",
        payload: { messageId: message.id, text: message.text },
        appliedStrategyRuleIds: []
      });
    }
    if (message.kind === "human") this.coordinator?.notifyActivity();
  }

  // 公开落子事件：颜色/区段/出牌顺序公开，暗牌数值不写入（可见性口径见记忆设计 §5）。
  recordPlacement(room: GameRoom, seatId: SeatId, segment: number, placed: PlacedCard) {
    const decisionMetadata = this.turnCoordinator.completePlacement(room, seatId, placed.id, segment);
    if (decisionMetadata) {
      const existing = room.agentState.seats.find((item) => item.seatId === seatId);
      if (existing) {
        existing.lastDecision = {
          source: decisionMetadata.source,
          ...(decisionMetadata.fallbackReason ? { fallbackReason: decisionMetadata.fallbackReason } : {}),
          appliedStrategyRuleIds: decisionMetadata.appliedStrategyRuleIds,
          relaxedStrategyRuleIds: decisionMetadata.relaxedStrategyRuleIds,
          at: Date.now()
        };
      }
    }
    const observation = recordRoomObservation(this.memory, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "placement",
      visibility: "public",
      sourceSeatId: seatId,
      payload: {
        cardId: placed.id,
        segment,
        color: placed.color,
        playOrder: placed.playOrder,
        revealed: placed.revealed,
        ...(placed.revealed ? { value: placed.value } : {})
      }
    });
    if (observation) {
      this.memory.recordOwnAction(seatId, {
        kind: "placement",
        payload: {
          cardId: placed.id,
          segment,
          ...(decisionMetadata?.knownCard
            ? {
                knownValue: decisionMetadata.knownCard.value,
                knownColor: decisionMetadata.knownCard.color
              }
            : {})
        },
        appliedStrategyRuleIds: decisionMetadata?.appliedStrategyRuleIds ?? []
      });
      this.memory.applyRuleOutcomes(
        seatId,
        decisionMetadata?.appliedStrategyRuleIds ?? [],
        decisionMetadata?.relaxedStrategyRuleIds ?? []
      );
    }
  }

  // 提示窗口结算事件：选择翻开时数值已公开，随事件一并写入。
  recordHintDecision(
    room: GameRoom,
    seatId: SeatId,
    decision: HintDecidePayload["decision"],
    hint: { cardId: string; segment: number }
  ) {
    const placed = room.placements[hint.segment]?.find((card) => card.id === hint.cardId);
    const observation = recordRoomObservation(this.memory, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "hint",
      visibility: "public",
      sourceSeatId: seatId,
      payload: {
        decision,
        cardId: hint.cardId,
        segment: hint.segment,
        ...(placed?.revealed ? { value: placed.value } : {})
      }
    });
    if (observation) {
      this.memory.recordOwnAction(seatId, {
        kind: "hint",
        payload: { decision, cardId: hint.cardId, segment: hint.segment },
        appliedStrategyRuleIds: []
      });
    }
  }

  recordPhaseChange(room: GameRoom) {
    const attempt = this.memory.currentAttempt();
    if (!attempt || attempt.identity.attemptId !== room.identity.attemptId) return;
    const alreadyRecorded = attempt.shared.observations.some(
      (observation) =>
        observation.type === "phase_changed" &&
        (observation.payload as { phaseVersion?: unknown })?.phaseVersion === room.phaseVersion
    );
    if (alreadyRecorded) return;
    recordRoomObservation(this.memory, room, {
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion,
      type: "phase_changed",
      visibility: "public",
      payload: { phase: room.phase, phaseVersion: room.phaseVersion }
    });
  }

  // 模型顺带提出的实体候选：来源引用消息 id，服务端映射为公开 chat observation id
  // 后走统一的 schema/可见性/来源校验（entities.ts）。
  private ingestDiscussionEntities(
    room: GameRoom,
    seatId: SeatId,
    candidates: DiscussionEntityCandidate[],
    currentMessageId: string
  ) {
    const attempt = this.memory.currentAttempt();
    if (!attempt || attempt.identity.attemptId !== room.identity.attemptId) return;

    const observationIdByMessageId = new Map<string, string>();
    for (const observation of attempt.shared.observations) {
      if (observation.type !== "chat") continue;
      const messageId = (observation.payload as { messageId?: unknown })?.messageId;
      if (typeof messageId === "string") observationIdByMessageId.set(messageId, observation.id);
    }

    const mapped = candidates.map(({ sourceMessageIds, ...candidate }) => ({
      ...candidate,
      sourceObservationIds: sourceMessageIds
        .map((id) => observationIdByMessageId.get(id === CURRENT_DISCUSSION_MESSAGE_SOURCE ? currentMessageId : id))
        .filter((id): id is string => Boolean(id))
    }));
    ingestEntityCandidates(this.memory, seatId, mapped);
  }

  // 讨论结束：取消未完成发言，每个 Agent 基于当时的公开内容独立收口并锁定策略。
  // 收口开始时捕获 attempt token；模型响应返回后必须重新校验房间与
  // memory 仍处于同一 attempt 才提交，过期响应直接丢弃（ACR-01）。
  async finalizeDiscussion(room: GameRoom) {
    this.cancelDiscussion();
    const attemptToken = room.identity.attemptId;
    const levelRunToken = room.identity.levelRunId;
    const phaseVersionToken = room.phaseVersion;
    const turnVersionToken = room.turnVersion;
    if (!attemptToken || this.memory.currentAttempt()?.identity.attemptId !== attemptToken) return;

    const agentSeatIds = this.agentSeatIds(room);
    const contractView = agentSeatIds[0]
      ? buildDiscussionView(room, agentSeatIds[0], this.memory, this.discussionGuard.excludedMessageIds())
      : null;
    const contract = contractView
      ? compilePublicContract(contractView, this.memory.publicContract()?.revision ?? 0)
      : null;
    if (contract) {
      this.memory.setPublicContract(contract);
      room.agentState.contract = {
        revision: contract.revision,
        rules: contract.rules.map((rule) => ({
          id: rule.id,
          type: rule.type,
          strength: rule.strength,
          targetSeatIds: [...rule.targetSeatIds],
          ...(rule.targetSegments ? { targetSegments: [...rule.targetSegments] } : {})
        }))
      };
    }

    // 收口阻塞 discussion → placing 切换（registerHandlers await 本方法），
    // 逐座位串行会把停顿放大为 Σ(座位数)；并行化后墙钟时间为单次调用的 max。
    // 每个座位保留独立的 AbortController 与 attempt token 复检（ACR-01）。
    await Promise.all(
      agentSeatIds.map(async (seatId) => {
        const controller = new AbortController();
        this.managedRequests.add(controller);
        const deadline = setTimeout(() => abortModelRequest(controller, "deadline"), this.strategyDeadlineMs);
        try {
          const proposal = await this.planner.compileForSeat(
            seatId,
            buildDiscussionView(room, seatId, this.memory, this.discussionGuard.excludedMessageIds()),
            { signal: controller.signal }
          );
          if (
            room.identity.attemptId !== attemptToken ||
            room.identity.levelRunId !== levelRunToken ||
            room.phase !== "discussion" ||
            room.phaseVersion !== phaseVersionToken ||
            room.turnVersion !== turnVersionToken ||
            this.memory.currentAttempt()?.identity.attemptId !== attemptToken
          ) {
            console.warn(
              JSON.stringify({ event: "strategy:stale_response_discarded", seatId, attemptId: attemptToken })
            );
            return;
          }
          // 收口失败不得伪装成成功的空策略：切换到公开事实兜底，
          // 并在策略上标注 source / compileOutcome（P0-2）。
          let draftInput: Parameters<AttemptMemoryStore["setStrategyDraft"]>[1];
          if (proposal.outcome === "ok") {
            draftInput = { ...proposal, source: "model" };
          } else {
            const fallback = buildPublicFactsFallback(this.memory.viewForSeat(seatId));
            draftInput = {
              ...fallback,
              source: fallback.rules.length > 0 ? "public_facts_fallback" : "unavailable",
              compileOutcome: proposal.outcome
            };
            console.warn(
              JSON.stringify({
                event: "strategy:fallback_locked",
                seatId,
                attemptId: attemptToken,
                compileOutcome: proposal.outcome,
                source: draftInput.source,
                ruleCount: fallback.rules.length
              })
            );
          }
          const publicContractRules = contract ? contractRulesForSeat(contract, seatId) : [];
          const publicKeys = new Set(
            publicContractRules.map((rule) =>
              JSON.stringify([rule.type, [...rule.targetSeatIds].sort(), [...(rule.targetSegments ?? [])].sort()])
            )
          );
          draftInput.rules = [
            ...publicContractRules,
            ...draftInput.rules.filter(
              (rule) =>
                !publicKeys.has(
                  JSON.stringify([rule.type, [...rule.targetSeatIds].sort(), [...(rule.targetSegments ?? [])].sort()])
                )
            )
          ];
          this.memory.setStrategyDraft(seatId, draftInput);
          const strategy = this.memory.lockStrategy(seatId);
          const publicRules = strategy.rules
            .filter((rule) => rule.sourceMessageIds.length > 0)
            .map((rule) => ({
              id: rule.id,
              type: rule.type,
              strength: rule.strength,
              targetSeatIds: [...rule.targetSeatIds],
              ...(rule.targetSegments ? { targetSegments: [...rule.targetSegments] } : {})
            }));
          room.agentState.seats = [
            ...room.agentState.seats.filter((item) => item.seatId !== seatId),
            { seatId, strategyVersion: strategy.version, strategySource: strategy.source, strategyRules: publicRules }
          ].sort((left, right) => left.seatId.localeCompare(right.seatId));
        } catch (error) {
          console.warn(JSON.stringify({ event: "strategy:finalize_failed", seatId, error: String(error) }));
        } finally {
          clearTimeout(deadline);
          this.managedRequests.delete(controller);
        }
      })
    );
  }

  // 结果阶段：失败生成同进程 RetryBrief；通关清理该 levelRun 的历史 brief。
  // 超时/玩家离开没有揭示结果，生成只含确定性公开字段的降级摘要（ACR-04）。
  onResult(room: GameRoom): RetryBrief | null {
    this.cancelDiscussion();
    const attempt = this.memory.currentAttempt();
    if (!attempt || attempt.identity.attemptId !== room.identity.attemptId) return null;

    // 没有揭示结果也没有失败原因说明对局还没结束，不做 finalization。
    if (!room.revealResult && !room.failureReason) return null;
    this.recordPhaseChange(room);

    // 公开结算事件：通过/失败与区段总和/牌数在揭示后全部公开；每 attempt 只记一次。
    if (!attempt.shared.observations.some((observation) => observation.type === "result")) {
      const pass = room.revealResult?.pass ?? false;
      recordRoomObservation(this.memory, room, {
        phaseVersion: room.phaseVersion,
        turnVersion: room.turnVersion,
        type: "result",
        visibility: "public",
        payload: {
          pass,
          failureReason: pass ? null : room.failureReason ?? "rule-unmet",
          ...(room.revealResult
            ? { segmentSums: room.revealResult.segmentSums, segmentCounts: room.revealResult.segmentCounts }
            : {})
        }
      });
    }

    if (room.revealResult?.pass) {
      room.agentState.review = {
        sourceAttemptId: attempt.identity.attemptId,
        passedSegments: [0, 1, 2, 3, 4, 5],
        failedSegments: [],
        lessons: ["本次公开协作方案通过了全部区段。"],
        unresolvedIssues: []
      };
      this.memory.closeLevelRun(attempt.identity.levelRunId);
      return null;
    }

    const failureReason = room.failureReason ?? "rule-unmet";
    if (!room.revealResult) {
      const brief = this.memory.finishAttempt({ passedSegments: [], failedSegments: [], failureReason });
      if (brief) this.publishReview(room, brief);
      if (brief && this.agentSeatIds(room).length > 0) this.enrichRetryBrief(room, brief);
      return brief;
    }

    const failedSegments = failedSegmentsOf(room);
    const passedSegments = [0, 1, 2, 3, 4, 5].filter((segment) => !failedSegments.includes(segment));
    const brief = this.memory.finishAttempt({ passedSegments, failedSegments, failureReason });
    if (brief) this.publishReview(room, brief);
    if (brief && this.agentSeatIds(room).length > 0) this.enrichRetryBrief(room, brief);
    return brief;
  }

  private publishReview(room: GameRoom, brief: RetryBrief) {
    room.agentState.review = {
      sourceAttemptId: brief.sourceAttemptId,
      passedSegments: [...brief.passedSegments],
      failedSegments: [...brief.failedSegments],
      lessons: brief.lessons.map((lesson) => lesson.description),
      unresolvedIssues: [...brief.unresolvedIssues],
      contractOutcomes: structuredClone(brief.contractOutcomes)
    };
  }

  private enrichRetryBrief(room: GameRoom, brief: RetryBrief) {
    const attempt = this.memory.currentAttempt();
    if (!attempt || attempt.identity.attemptId !== brief.sourceAttemptId) return;
    const token = {
      attemptId: brief.sourceAttemptId,
      phaseVersion: room.phaseVersion,
      turnVersion: room.turnVersion
    };
    const controller = new AbortController();
    this.managedRequests.add(controller);
    const deadline = setTimeout(() => abortModelRequest(controller, "deadline"), this.retryBriefDeadlineMs);
    void this.orchestrator
      .generateRetryLessons(
        {
          seatId: "system",
          attemptId: token.attemptId,
          phaseVersion: token.phaseVersion,
          turnVersion: token.turnVersion,
          level: room.currentChallenge ? { id: room.currentChallenge.id } : null,
          seats: room.seats.filter((seat) => Boolean(seat.nick)),
          publicBrief: brief,
          publicObservationIds: attempt.shared.observations.map((observation) => observation.id)
        },
        { signal: controller.signal }
      )
      .then((lessons) => {
        if (!lessons) return;
        if (room.identity.attemptId !== token.attemptId) return;
        if (room.phaseVersion !== token.phaseVersion || room.turnVersion !== token.turnVersion) return;
        if (this.memory.currentAttempt()?.identity.attemptId !== token.attemptId) return;
        this.memory.updateRetryBriefLessons(token.attemptId, lessons);
      })
      .catch((error) => {
        console.warn(JSON.stringify({ event: "retry_brief:model_failed", error: String(error) }));
      })
      .finally(() => {
        clearTimeout(deadline);
        this.managedRequests.delete(controller);
      });
  }

  dropSeat(seatId: SeatId) {
    this.memory.dropSeat(seatId);
  }

  resetSession() {
    this.cancelDiscussion();
    this.memory.clearSession();
  }
}
