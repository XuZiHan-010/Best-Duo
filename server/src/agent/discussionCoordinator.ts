import type { DiscussionView, GameRoom, SeatId } from "@take-time/shared";
import type { AttemptMemoryStore } from "./memory/attemptMemoryStore.js";
import type { DiscussionDecision, DiscussionEntityCandidate } from "./orchestrator.js";
import { abortModelRequest } from "./modelAbort.js";
import { buildDiscussionView } from "./views.js";

export interface DiscussionSpeaker {
  seatId: SeatId;
  decideDiscussion(
    view: DiscussionView,
    options?: { signal?: AbortSignal }
  ): Promise<DiscussionDecision | null>;
}

export interface DiscussionCoordinatorOptions {
  maxMessagesPerAgent?: number;
  cooldownMs?: number;
  delay?: (ms: number) => Promise<void>;
  // 提供 memory 时，发言视图会注入公开实体与同关 RetryBrief。
  memory?: AttemptMemoryStore;
  // 被安全防护拦截的消息不得进入任何模型上下文。
  excludedMessageIds?: () => ReadonlySet<string>;
  // 生产讨论在一轮无人发言后保持休眠，收到新的真人消息时再继续；
  // 单元测试和一次性离线调用可保持默认 false，让 start() 自然结束。
  waitForActivity?: boolean;
  // 进入讨论后先等第一条真人消息，不让 Agent 无条件抢先发言。
  waitForInitialActivity?: boolean;
  requestDeadlineMs?: number;
  // 真人连发消息时等待的安静窗口毫秒数；测试可传 0。
  quietWindowMs?: number;
  // 同一座位连续 N 次未产出发言（模型失败/超时/非法输出）后，本 attempt 不再尝试，
  // 防止真人每发一条消息就触发一次注定失败的重试、静默烧穿调用预算。
  maxConsecutiveFailures?: number;
  onMessage: (
    seatId: SeatId,
    message: string,
    entities?: DiscussionEntityCandidate[],
    // 模型对 focusMessage 的话题判定：off_topic 推进该真人座位的退避阶梯，on_topic 让其恢复。
    verdict?: { focusMessageId: string; topic: "on_topic" | "off_topic" }
  ) => void;
  // 某 Agent 座位连续失败到上限、本 attempt 不再尝试发言时触发一次。
  // AI 完全缺席策略形成是行动性信息：人类会默认它听到了、同意了，据此行动。
  onSpeakerExhausted?: (seatId: SeatId) => void;
}

const defaultDelay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// 产品层不限制 AI 每局发言次数（2026-07-21 findings P1-1）：节流由
// “每轮每 Agent 至多一次 + 冷却 + 模型 wait 决策 + 分桶预算”共同保证。
// maxMessagesPerAgent 仅保留为测试/诊断旋钮；spokenCounts 只用于遥测。
const DEFAULT_MAX_MESSAGES = Number.POSITIVE_INFINITY;
const DEFAULT_COOLDOWN_MS = 4_000;
const DEFAULT_REQUEST_DEADLINE_MS = 30_000;
const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3;
// 真人连发消息的安静窗口：等输入停顿后再调用模型，把多条消息合并进一次请求（P1-2）。
const DEFAULT_QUIET_WINDOW_MS = 800;

// 讨论阶段 Agent 发言调度：顺序轮转、冷却、最大次数；
// 阶段结束或 cancel 后，未完成的发言结果一律丢弃。
export class DiscussionCoordinator {
  private cancelled = false;
  private readonly maxMessagesPerAgent: number;
  private readonly cooldownMs: number;
  private readonly delay: (ms: number) => Promise<void>;
  private readonly memory?: AttemptMemoryStore;
  private readonly excludedMessageIds: () => ReadonlySet<string>;
  private readonly waitForActivity: boolean;
  private readonly waitForInitialActivity: boolean;
  private readonly onMessage: DiscussionCoordinatorOptions["onMessage"];
  private readonly onSpeakerExhausted: (seatId: SeatId) => void;
  private readonly requestDeadlineMs: number;
  private readonly maxConsecutiveFailures: number;
  private activityVersion = 0;
  private activityWaiter: (() => void) | null = null;
  private activeRequest: AbortController | null = null;
  private lastActivityAt = 0;
  private readonly quietWindowMs: number;
  // 被新消息取代（superseded）的请求：返回 null 不算模型失败。
  private readonly supersededRequests = new WeakSet<AbortController>();

  constructor(
    private readonly room: GameRoom,
    private readonly speakers: DiscussionSpeaker[],
    options: DiscussionCoordinatorOptions
  ) {
    this.maxMessagesPerAgent = options.maxMessagesPerAgent ?? DEFAULT_MAX_MESSAGES;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.delay = options.delay ?? defaultDelay;
    this.memory = options.memory;
    this.excludedMessageIds = options.excludedMessageIds ?? (() => new Set());
    this.waitForActivity = options.waitForActivity ?? false;
    this.waitForInitialActivity = options.waitForInitialActivity ?? false;
    this.requestDeadlineMs = options.requestDeadlineMs ?? DEFAULT_REQUEST_DEADLINE_MS;
    this.quietWindowMs = options.quietWindowMs ?? DEFAULT_QUIET_WINDOW_MS;
    this.maxConsecutiveFailures = options.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES;
    this.onMessage = options.onMessage;
    this.onSpeakerExhausted = options.onSpeakerExhausted ?? (() => {});
  }

  cancel() {
    this.cancelled = true;
    if (this.activeRequest) abortModelRequest(this.activeRequest, "phase_changed");
    this.activityWaiter?.();
    this.activityWaiter = null;
  }

  // 真人的新公开消息会唤醒一个因“本轮无人发言”而休眠的协调器。
  // 在途的发言请求此刻已失去对话焦点：立即取消（superseded），
  // 等安静窗口后对最新完整上下文只重新调用一次（P1-2）。
  notifyActivity() {
    this.activityVersion += 1;
    this.lastActivityAt = Date.now();
    if (this.activeRequest) {
      this.supersededRequests.add(this.activeRequest);
      abortModelRequest(this.activeRequest, "superseded");
    }
    this.activityWaiter?.();
    this.activityWaiter = null;
  }

  private isActive(startPhaseVersion: number, startAttemptId: string | null): boolean {
    return (
      !this.cancelled &&
      this.room.phase === "discussion" &&
      this.room.phaseVersion === startPhaseVersion &&
      this.room.identity.attemptId === startAttemptId &&
      Boolean(startAttemptId)
    );
  }

  async start(): Promise<void> {
    const startPhaseVersion = this.room.phaseVersion;
    const startAttemptId = this.room.identity.attemptId;
    const spokenCounts = new Map<SeatId, number>(this.speakers.map((speaker) => [speaker.seatId, 0]));
    const failureStreaks = new Map<SeatId, number>(this.speakers.map((speaker) => [speaker.seatId, 0]));

    if (this.waitForInitialActivity && this.isActive(startPhaseVersion, startAttemptId)) {
      await new Promise<void>((resolve) => {
        this.activityWaiter = resolve;
      });
    }

    while (this.isActive(startPhaseVersion, startAttemptId)) {
      const activityAtRoundStart = this.activityVersion;
      let anyoneSpoke = false;
      let anyoneEligible = false;

      for (const speaker of this.speakers) {
        if (!this.isActive(startPhaseVersion, startAttemptId)) return;
        const count = spokenCounts.get(speaker.seatId) ?? 0;
        if (count >= this.maxMessagesPerAgent) continue;
        if ((failureStreaks.get(speaker.seatId) ?? 0) >= this.maxConsecutiveFailures) continue;
        anyoneEligible = true;

        // 安静窗口：真人正在连发时先等输入停顿，把多条消息合并进一次调用。
        const sinceActivity = Date.now() - this.lastActivityAt;
        if (sinceActivity < this.quietWindowMs) await this.delay(this.quietWindowMs - sinceActivity);
        if (!this.isActive(startPhaseVersion, startAttemptId)) return;

        let result: DiscussionDecision | null = null;
        const controller = new AbortController();
        this.activeRequest = controller;
        const deadline = setTimeout(() => abortModelRequest(controller, "deadline"), this.requestDeadlineMs);
        try {
          result = await speaker.decideDiscussion(
            buildDiscussionView(this.room, speaker.seatId, this.memory, this.excludedMessageIds()),
            { signal: controller.signal }
          );
        } catch (error) {
          console.warn(
            JSON.stringify({ event: "discussion:speaker_failed", seatId: speaker.seatId, error: String(error) })
          );
        } finally {
          clearTimeout(deadline);
          if (this.activeRequest === controller) this.activeRequest = null;
        }

        // await 期间阶段可能已结束：迟到的发言不得写入 chat。
        if (!this.isActive(startPhaseVersion, startAttemptId)) return;
        // 被新消息取代不是模型失败：不推进熔断，交给新 activity 轮对最新上下文重算。
        if (!result && this.supersededRequests.has(controller)) continue;
        if (!result) {
          const streak = (failureStreaks.get(speaker.seatId) ?? 0) + 1;
          failureStreaks.set(speaker.seatId, streak);
          // 恰好跨过阈值那一刻触发一次，避免每轮重复通知。
          if (streak === this.maxConsecutiveFailures) {
            console.warn(
              JSON.stringify({ event: "discussion:speaker_exhausted", seatId: speaker.seatId, streak })
            );
            this.onSpeakerExhausted(speaker.seatId);
          }
          continue;
        }

        failureStreaks.set(speaker.seatId, 0);
        if (result.action === "wait") continue;
        // focusMessage 取自已过滤的视图，这里的对照必须应用同一份排除集，
        // 否则一条消息被 guard 排除后两边永远对不上，模型回复会被无条件丢弃、白烧调用。
        const excluded = this.excludedMessageIds();
        const latestHumanMessage = [...this.room.chat]
          .reverse()
          .find((message) => message.kind === "human" && !excluded.has(message.id));
        // 模型思考期间若真人又发了新消息，旧回复已经失去对话焦点，直接丢弃并在新 activity 轮重算。
        if (!latestHumanMessage || result.replyToMessageId !== latestHumanMessage.id) continue;
        spokenCounts.set(speaker.seatId, count + 1);
        anyoneSpoke = true;
        this.onMessage(
          speaker.seatId,
          result.message,
          result.action === "decline_off_topic" ? undefined : result.entities,
          {
            focusMessageId: latestHumanMessage.id,
            topic: result.action === "decline_off_topic" ? "off_topic" : "on_topic"
          }
        );
        await this.delay(this.cooldownMs);
      }

      if (!anyoneEligible) return;
      if (!this.waitForActivity && !anyoneSpoke) return;
      if (!this.waitForActivity) continue;

      // 生产模式每轮至多让每个 Agent 说一次，然后等待新的真人消息，
      // 避免开场连续耗尽全部发言额度。失败到上限的座位不算剩余发言者。
      const hasRemainingSpeaker = this.speakers.some(
        (speaker) =>
          (spokenCounts.get(speaker.seatId) ?? 0) < this.maxMessagesPerAgent &&
          (failureStreaks.get(speaker.seatId) ?? 0) < this.maxConsecutiveFailures
      );
      if (!hasRemainingSpeaker) return;
      // 模型调用期间已经有新消息到达时立即重跑，避免在检查与挂起之间丢唤醒。
      if (this.activityVersion !== activityAtRoundStart) continue;
      await new Promise<void>((resolve) => {
        this.activityWaiter = resolve;
      });
    }
  }
}
