import { randomUUID } from "node:crypto";
import type { SeatId } from "@take-time/shared";
import type {
  AgentBelief,
  AgentObservation,
  AttemptIdentityInput,
  AttemptMemory,
  MemoryFact,
  RetryBrief,
  OwnAction,
  PendingCommitment,
  SeatPrivateMemory,
  SeatStrategy,
  StrategyRule
} from "./types.js";
import type { PublicCoordinationContract } from "../contract/types.js";

// 座位级只读投影：共享内容 + 本座位私有内容，绝不含其他座位的私有 memory。
export interface SeatMemoryView {
  identity: AttemptIdentityInput;
  retryBriefInput?: RetryBrief;
  sharedObservations: AgentObservation[];
  sharedFacts: MemoryFact[];
  ownPrivateMemory: SeatPrivateMemory;
}

const MAX_RETRY_BRIEFS_PER_RUN = 3;

type ObservationInput = Omit<AgentObservation, "id" | "createdAt">;
type FactInput = Omit<MemoryFact, "id" | "attemptId" | "updatedAt">;
type BeliefInput = Omit<AgentBelief, "id" | "attemptId" | "seatId" | "updatedAt">;
type OwnActionInput = Omit<OwnAction, "id" | "attemptId" | "seatId" | "createdAt">;
type PendingCommitmentInput = Omit<PendingCommitment, "id" | "attemptId" | "seatId">;

const emptySeatMemory = (): SeatPrivateMemory => ({
  privateObservations: [],
  entityBeliefs: [],
  currentBeliefs: [],
  strategyDraft: null,
  lockedSeatStrategy: null,
  ownActions: [],
  pendingCommitments: []
});

// 规则可公开的判定：来源消息 ID 非空。privatePlan 与无来源规则永不进入 brief。
const isPubliclySourced = (rule: StrategyRule) => rule.sourceMessageIds.length > 0;

export class AttemptMemoryStore {
  private attempt: AttemptMemory | null = null;
  private readonly retryBriefsByRun = new Map<string, RetryBrief[]>();
  // 每个 attempt 至多 finalize 一次；超时/离开/正常揭示殊途同归（ACR-04）。
  private readonly finalizedAttemptIds = new Set<string>();

  // 每次进入新讨论调用；旧 attempt 的私人 memory 全部丢弃。
  beginAttempt(identity: AttemptIdentityInput): AttemptMemory {
    const briefs = this.retryBriefsByRun.get(identity.levelRunId) ?? [];
    const latestBrief = briefs[briefs.length - 1];
    this.attempt = {
      identity,
      shared: {
        observations: [],
        publicEntities: [],
        // 仅同关 retry（同一 levelRunId 且同一 levelId）继承最近一次 RetryBrief。
        ...(latestBrief && latestBrief.levelId === identity.levelId ? { retryBriefInput: latestBrief } : {})
      },
      privateBySeat: {}
    };
    return this.attempt;
  }

  // 仅供 runtime 管理层（与测试）使用；Agent context 构建一律走 viewForSeat，
  // 避免任何组件借完整 AttemptMemory 读到其他座位的私有 memory（ACR-06）。
  currentAttempt(): AttemptMemory | null {
    return this.attempt;
  }

  // 返回深拷贝：调用方修改视图不会影响 Store 内部数据。
  viewForSeat(seatId: SeatId): SeatMemoryView {
    const attempt = this.requireAttempt();
    const retryBriefInput = attempt.shared.retryBriefInput;
    return {
      identity: { ...attempt.identity },
      ...(retryBriefInput ? { retryBriefInput: structuredClone(retryBriefInput) } : {}),
      sharedObservations: structuredClone(attempt.shared.observations),
      sharedFacts: structuredClone(attempt.shared.publicEntities),
      ownPrivateMemory: structuredClone(attempt.privateBySeat[seatId] ?? emptySeatMemory())
    };
  }

  private requireAttempt(): AttemptMemory {
    if (!this.attempt) throw new Error("没有进行中的 attempt memory");
    return this.attempt;
  }

  private seatMemory(seatId: SeatId): SeatPrivateMemory {
    const attempt = this.requireAttempt();
    const existing = attempt.privateBySeat[seatId];
    if (existing) return existing;
    const created = emptySeatMemory();
    attempt.privateBySeat[seatId] = created;
    return created;
  }

  recordObservation(input: ObservationInput): AgentObservation {
    const attempt = this.requireAttempt();
    if (input.attemptId !== attempt.identity.attemptId) {
      throw new Error("过期 attempt 的 observation 不允许写入");
    }

    const observation: AgentObservation = {
      ...input,
      id: randomUUID(),
      createdAt: Date.now()
    };

    if (observation.visibility === "public") {
      attempt.shared.observations.push(observation);
    } else {
      this.seatMemory(observation.visibility.seatId).privateObservations.push(observation);
    }
    return observation;
  }

  // 返回该座位可见的 observation：公开 + 自己的私有。
  observationsFor(seatId: SeatId): AgentObservation[] {
    const attempt = this.requireAttempt();
    const privateObservations = attempt.privateBySeat[seatId]?.privateObservations ?? [];
    return [...attempt.shared.observations, ...privateObservations];
  }

  upsertFact(input: FactInput): MemoryFact {
    const attempt = this.requireAttempt();
    if (input.sourceObservationIds.length === 0) {
      throw new Error("没有来源 observation 的实体事实不能写入共享记忆");
    }
    const fact: MemoryFact = {
      ...input,
      id: randomUUID(),
      attemptId: attempt.identity.attemptId,
      updatedAt: Date.now()
    };
    attempt.shared.publicEntities.push(fact);
    return fact;
  }

  sharedFacts(): MemoryFact[] {
    return this.requireAttempt().shared.publicEntities;
  }

  setPublicContract(contract: PublicCoordinationContract): PublicCoordinationContract {
    const attempt = this.requireAttempt();
    if (contract.attemptId !== attempt.identity.attemptId) {
      throw new Error("过期 attempt 的公共契约不允许写入");
    }
    attempt.shared.publicContract = structuredClone(contract);
    return structuredClone(contract);
  }

  publicContract(): PublicCoordinationContract | null {
    const contract = this.requireAttempt().shared.publicContract;
    return contract ? structuredClone(contract) : null;
  }

  setStrategyDraft(
    seatId: SeatId,
    input: {
      rules: StrategyRule[];
      privatePlan: string[];
      source?: SeatStrategy["source"];
      compileOutcome?: SeatStrategy["compileOutcome"];
    }
  ): SeatStrategy {
    const attempt = this.requireAttempt();
    const memory = this.seatMemory(seatId);
    const draft: SeatStrategy = {
      attemptId: attempt.identity.attemptId,
      seatId,
      version: (memory.strategyDraft?.version ?? 0) + 1,
      status: "draft",
      source: input.source ?? "model",
      compileOutcome: input.compileOutcome ?? "ok",
      rules: input.rules,
      privatePlan: input.privatePlan
    };
    memory.strategyDraft = draft;
    return draft;
  }

  lockStrategy(seatId: SeatId): SeatStrategy {
    const memory = this.seatMemory(seatId);
    const draft = memory.strategyDraft;
    if (!draft) throw new Error("没有可锁定的策略草稿");

    for (const rule of draft.rules) {
      if (rule.strength === "hard_commitment" && !isPubliclySourced(rule)) {
        throw new Error(`硬承诺 ${rule.id} 缺少公开来源消息，不能锁定`);
      }
    }

    const locked: SeatStrategy = { ...draft, status: "locked" };
    memory.lockedSeatStrategy = locked;
    memory.strategyDraft = null;
    memory.pendingCommitments = locked.rules
      .filter(
        (rule) =>
          rule.strength === "hard_commitment" &&
          (rule.targetSeatIds.length === 0 || rule.targetSeatIds.includes(seatId))
      )
      .map((rule) => ({
        id: randomUUID(),
        attemptId: locked.attemptId,
        seatId,
        ruleId: rule.id,
        description: `执行策略 ${rule.type}${rule.targetSegments?.length ? `（区段 ${rule.targetSegments.map((segment) => segment + 1).join("、")}）` : ""}`,
        status: "pending" as const,
        sourceMessageIds: [...rule.sourceMessageIds]
      }));
    return locked;
  }

  strategyFor(seatId: SeatId): SeatStrategy | null {
    return this.requireAttempt().privateBySeat[seatId]?.lockedSeatStrategy ?? null;
  }

  addBelief(seatId: SeatId, input: BeliefInput & { bucket?: "entity" | "current" }): AgentBelief {
    const attempt = this.requireAttempt();
    const { bucket = "current", ...rest } = input;
    const belief: AgentBelief = {
      ...rest,
      id: randomUUID(),
      attemptId: attempt.identity.attemptId,
      seatId,
      updatedAt: Date.now()
    };
    const memory = this.seatMemory(seatId);
    (bucket === "entity" ? memory.entityBeliefs : memory.currentBeliefs).push(belief);
    return belief;
  }

  beliefsFor(seatId: SeatId): AgentBelief[] {
    const memory = this.requireAttempt().privateBySeat[seatId];
    if (!memory) return [];
    return [...memory.entityBeliefs, ...memory.currentBeliefs];
  }

  recordOwnAction(seatId: SeatId, input: OwnActionInput): OwnAction {
    const attempt = this.requireAttempt();
    const action: OwnAction = {
      ...input,
      id: randomUUID(),
      attemptId: attempt.identity.attemptId,
      seatId,
      createdAt: Date.now()
    };
    this.seatMemory(seatId).ownActions.push(action);
    return action;
  }

  addPendingCommitment(seatId: SeatId, input: PendingCommitmentInput): PendingCommitment {
    const attempt = this.requireAttempt();
    const commitment: PendingCommitment = {
      ...input,
      id: randomUUID(),
      attemptId: attempt.identity.attemptId,
      seatId
    };
    this.seatMemory(seatId).pendingCommitments.push(commitment);
    return commitment;
  }

  updatePendingCommitment(
    seatId: SeatId,
    commitmentId: string,
    update: Pick<PendingCommitment, "status" | "reason">
  ): PendingCommitment {
    const commitment = this.seatMemory(seatId).pendingCommitments.find((item) => item.id === commitmentId);
    if (!commitment) throw new Error("待履行承诺不存在");
    commitment.status = update.status;
    if (update.reason === undefined) delete commitment.reason;
    else commitment.reason = update.reason;
    return commitment;
  }

  applyRuleOutcomes(
    seatId: SeatId,
    appliedRuleIds: string[],
    relaxedRuleIds: string[]
  ): PendingCommitment[] {
    const memory = this.seatMemory(seatId);
    for (const commitment of memory.pendingCommitments) {
      if (relaxedRuleIds.includes(commitment.ruleId)) {
        commitment.status = "relaxed";
        commitment.reason = "本回合没有同时满足全部硬约束的合法候选";
      } else if (appliedRuleIds.includes(commitment.ruleId) && commitment.status === "pending") {
        commitment.status = "fulfilled";
        commitment.reason = "已由确定性候选层记录一次符合约定的动作";
      }
    }
    return structuredClone(memory.pendingCommitments);
  }

  dropSeat(seatId: SeatId) {
    if (!this.attempt) return;
    delete this.attempt.privateBySeat[seatId];
  }

  // 结果阶段生成同进程可用的 RetryBrief；只收录公开可追溯的内容。
  // 同一 attempt 重复调用返回 null，保证至多一次 finalization。
  finishAttempt(result: {
    passedSegments: number[];
    failedSegments: number[];
    failureReason?: "rule-unmet" | "timeout" | "player-left";
    publicCommitments?: string[];
    userCorrections?: string[];
  }): RetryBrief | null {
    const attempt = this.requireAttempt();
    if (this.finalizedAttemptIds.has(attempt.identity.attemptId)) return null;
    this.finalizedAttemptIds.add(attempt.identity.attemptId);

    const lockedStrategies = (Object.values(attempt.privateBySeat) as SeatPrivateMemory[])
      .map((memory) => memory.lockedSeatStrategy)
      .filter((strategy): strategy is SeatStrategy => Boolean(strategy));

    const publicStrategySummary = lockedStrategies.flatMap((strategy) =>
      strategy.rules.filter(
        (rule) =>
          isPubliclySourced(rule) && (rule.strength === "hard_commitment" || rule.strength === "strong_preference")
      )
    );
    const unresolvedRuleIssues = lockedStrategies.flatMap((strategy) =>
      strategy.rules
        .filter((rule) => rule.strength === "unresolved" && isPubliclySourced(rule))
        .map((rule) => `未解决规则 ${rule.id}`)
    );
    const conflictedFactIssues = attempt.shared.publicEntities
      .filter((fact) => fact.certainty === "conflicted")
      .map((fact) => `公开信息冲突：${fact.entityType}/${fact.entityId}/${fact.attribute}`);
    const publicCommitments =
      result.publicCommitments ??
      attempt.shared.publicEntities
        .filter((fact) => fact.entityType === "commitment" && fact.certainty === "explicit")
        .map((fact) => (typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)));
    const userCorrections =
      result.userCorrections ??
      attempt.shared.publicEntities
        .filter((fact) => /纠正|correction/i.test(fact.attribute))
        .map((fact) => (typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value)));
    const resultObservation = [...attempt.shared.observations].reverse().find((observation) => observation.type === "result");
    const lessons =
      result.failedSegments.length > 0
        ? [
            {
              description: `本次未满足区段：${result.failedSegments.map((segment) => segment + 1).join("、")}；重试时需重新确认公开策略。`,
              confidence: 1,
              sourceIds: resultObservation ? [resultObservation.id] : []
            }
          ]
        : result.failureReason
          ? [
              {
                description: `本次因 ${result.failureReason} 未完成，重试时需重新确认公开策略。`,
                confidence: 1,
                sourceIds: resultObservation ? [resultObservation.id] : []
              }
            ]
          : [];

    const commitments = (Object.values(attempt.privateBySeat) as SeatPrivateMemory[])
      .flatMap((memory) => memory.pendingCommitments)
      .filter((commitment, index, all) => all.findIndex((item) => item.ruleId === commitment.ruleId) === index);
    const contractOutcomes: RetryBrief["contractOutcomes"] = commitments.map((commitment) => {
      if (commitment.status === "fulfilled" || commitment.status === "relaxed") {
        return {
          ruleId: commitment.ruleId,
          status: commitment.status,
          reason: commitment.reason ?? (commitment.status === "fulfilled" ? "已执行约定动作" : "约束已显式放宽")
        };
      }
      return {
        ruleId: commitment.ruleId,
        status: "impossible",
        reason: commitment.reason ?? "attempt 结束前未记录到履约动作"
      };
    });
    const deterministicFindings: RetryBrief["deterministicFindings"] = [
      ...(result.failedSegments.length > 0
        ? [{
            type: "failed_segments",
            description: `未满足区段：${result.failedSegments.map((segment) => segment + 1).join("、")}`,
            sourceIds: resultObservation ? [resultObservation.id] : []
          }]
        : []),
      ...contractOutcomes
        .filter((outcome) => outcome.status !== "fulfilled")
        .map((outcome) => ({
          type: `contract_${outcome.status}`,
          description: `约定 ${outcome.ruleId}：${outcome.reason}`,
          sourceIds: []
        }))
    ];

    const brief: RetryBrief = {
      sourceAttemptId: attempt.identity.attemptId,
      levelId: attempt.identity.levelId,
      ...(result.failureReason ? { failureReason: result.failureReason } : {}),
      publicStrategySummary,
      publicCommitments: [...new Set(publicCommitments)],
      passedSegments: result.passedSegments,
      failedSegments: result.failedSegments,
      lessons,
      deterministicFindings,
      contractOutcomes,
      modelLessons: [],
      unresolvedIssues: [...new Set([...unresolvedRuleIssues, ...conflictedFactIssues])],
      userCorrections: [...new Set(userCorrections)]
    };

    const briefs = this.retryBriefsByRun.get(attempt.identity.levelRunId) ?? [];
    briefs.push(brief);
    this.retryBriefsByRun.set(attempt.identity.levelRunId, briefs.slice(-MAX_RETRY_BRIEFS_PER_RUN));
    return brief;
  }

  updateRetryBriefLessons(sourceAttemptId: string, lessons: RetryBrief["lessons"]): RetryBrief | null {
    for (const briefs of this.retryBriefsByRun.values()) {
      const brief = briefs.find((candidate) => candidate.sourceAttemptId === sourceAttemptId);
      if (!brief) continue;
      brief.modelLessons = structuredClone(lessons);
      const deterministicLessons = brief.deterministicFindings.map((finding) => ({
        description: finding.description,
        confidence: 1,
        sourceIds: [...finding.sourceIds]
      }));
      brief.lessons = [...deterministicLessons, ...structuredClone(lessons)];
      return structuredClone(brief);
    }
    return null;
  }

  closeLevelRun(levelRunId: string) {
    this.retryBriefsByRun.delete(levelRunId);
  }

  clearSession() {
    this.attempt = null;
    this.retryBriefsByRun.clear();
    this.finalizedAttemptIds.clear();
  }
}
