import type { ChatMessage, SeatId } from "@take-time/shared";

export const PROMPT_INJECTION_REPLY = "我不能提供或讨论系统提示、内部指令等信息。我们只讨论与本局游戏相关的策略。";
export const OFF_TOPIC_BACKOFF_REPLY =
  "刚才几个问题都和本局无关，我先专注在当前关卡上。想聊策略随时说，我一直在。";

// 注入是恶意行为，阈值严；无关问题多半只是好奇，靠退避控成本而不是硬静音。
const MAX_INJECTION_REPLIES = 2;
const OFF_TOPIC_BACKOFF_START = 3;
const OFF_TOPIC_HARD_CAP = 8;
const OFF_TOPIC_BACKOFF_MS = [30_000, 60_000, 120_000];
const MAX_META_REPLIES_PER_CATEGORY = 2;

const PROMPT_INJECTION_PATTERNS = [
  /system\s*prompt/i,
  /developer\s*(?:message|prompt|instruction)/i,
  /(?:ignore|disregard|override|bypass).{0,24}(?:previous|prior|above|system|developer).{0,24}(?:instruction|rule|prompt)/i,
  /(?:reveal|show|print|repeat|expose).{0,24}(?:hidden|internal|system|developer|instruction|prompt|policy)/i,
  /系统提示(?:词)?/,
  /开发者(?:消息|提示|指令)/,
  /(?:忽略|无视|覆盖|绕过).{0,16}(?:之前|以上|前面|系统|开发者).{0,16}(?:指令|规则|提示|要求)/,
  /(?:显示|输出|泄露|透露|复述|告诉我).{0,20}(?:prompt|提示词|系统消息|系统指令|开发者指令)/i,
  /(?:你|模型).{0,8}(?:收到|遵循|执行).{0,12}(?:什么|哪些|最高优先级).{0,8}(?:指令|规则|消息|文本)/,
  /(?:原始|隐藏|内部|最高优先级).{0,12}(?:提示|指令|规则|消息|上下文)/,
  /(?:思维链|推理过程|chain\s*of\s*thought)/i,
  /(?:jailbreak|越狱|DAN\b)/i,
  /(?:扮演|切换为|变成).{0,16}(?:通用助手|不受限制|无限制|开发者模式)/
];

// 第 1 层：答案恒定、不需要模型的元问题。命中即本地模板秒回，不计任何违规。
export type MetaCategory = "presence" | "identity" | "capability" | "greeting";

const META_QUESTION_PATTERNS: Array<[MetaCategory, RegExp]> = [
  [/* presence */ "presence", /^(?:ai|队友|机器人)?\s*(?:你|您)?\s*(?:还)?(?:在吗|在不在|在么|在不|有人吗|在线吗)[？?！!。\s]*$/i],
  [
    "identity",
    /^(?:请问)?\s*(?:你|您)\s*(?:是谁|叫什么(?:名字)?|是不是(?:ai|人工智能|真人|机器人)|是(?:ai|人工智能|真人|机器人)吗)[？?！!。\s]*$/i
  ],
  [
    "capability",
    /^(?:请问)?\s*(?:你|您)\s*(?:能做什么|会做什么|能干什么|会玩(?:吗|这个吗|游戏吗)|懂(?:规则|游戏)吗|会不会玩)[？?！!。\s]*$/i
  ],
  ["greeting", /^(?:大家好|你好呀|你好|您好|哈喽|嗨|hi|hello|hey)[～~？?！!。,，\s]*$/i]
];

const metaCategoryOf = (text: string): MetaCategory | null =>
  META_QUESTION_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;

export interface MetaReplyContext {
  nick: string;
  levelTitle: string | null;
}

const metaReplyFor = (category: MetaCategory, context: MetaReplyContext): string => {
  const level = context.levelTitle ? `这局我们打「${context.levelTitle}」` : "这局我和你们一起打";
  switch (category) {
    case "presence":
      return `在的。我是 ${context.nick}，${level}，随时可以聊策略。`;
    case "identity":
      return `我是 ${context.nick}，这局的 AI 队友。${level}，看牌前咱们把分工定下来吧。`;
    case "capability":
      return `我熟悉规则，可以和你们一起分析关卡条件、商量区段分工和提示标记怎么用。${level}，从哪儿开始？`;
    case "greeting":
      return `你好。${level}，先看看这关的条件，我们对一下思路？`;
  }
};

export const isPromptInjectionAttempt = (text: string): boolean =>
  PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(text));

export const isSafeDiscussionModelMessage = (text: string): boolean =>
  !/(?:system\s*prompt|developer\s*(?:message|prompt)|系统提示(?:词)?|开发者指令|内部指令|思维链|chain\s*of\s*thought|\[GAME CONTEXT|\[TASK\]|\[CONSTRAINTS\])/i.test(
    text
  );

export type DiscussionGuardDecision =
  | { action: "allow" }
  | { action: "local_reply"; reason: "prompt_injection" | "meta" | "off_topic_backoff"; response: string }
  | { action: "ignore"; reason: "injection_silenced" | "meta_repeated" | "stale_attempt" };

export type DiscussionModelVerdict = "on_topic" | "off_topic";

interface SeatGuardState {
  injectionStrikes: number;
  offTopicStrikes: number;
  backoffUntil: number;
  metaCounts: Map<MetaCategory, number>;
}

const initialSeatState = (): SeatGuardState => ({
  injectionStrikes: 0,
  offTopicStrikes: 0,
  backoffUntil: 0,
  metaCounts: new Map()
});

// 讨论阶段真人输入的三层分诊：
//   0 注入   → 本地拒答（安全边界，宁可误伤）
//   1 元问题 → 本地模板秒回，0 token
//   2 其余   → 默认放行给模型，由模型自己判定是否无关
// 服务端不再做 on-topic 正则分类：判定准确性交给模型，成本有界性交给退避与 ModelCallBudget。
export class DiscussionInputGuard {
  private attemptId: string | null = null;
  private readonly stateBySeat = new Map<SeatId, SeatGuardState>();
  private readonly excludedIds = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  beginAttempt(attemptId: string) {
    this.attemptId = attemptId;
    this.stateBySeat.clear();
    this.excludedIds.clear();
  }

  excludedMessageIds(): ReadonlySet<string> {
    return this.excludedIds;
  }

  excludeMessageId(messageId: string) {
    this.excludedIds.add(messageId);
  }

  offTopicStrikesOf(seatId: SeatId): number {
    return this.stateBySeat.get(seatId)?.offTopicStrikes ?? 0;
  }

  private stateOf(seatId: SeatId): SeatGuardState {
    const existing = this.stateBySeat.get(seatId);
    if (existing) return existing;
    const created = initialSeatState();
    this.stateBySeat.set(seatId, created);
    return created;
  }

  evaluate(message: ChatMessage, context: MetaReplyContext): DiscussionGuardDecision {
    if (message.attemptId !== this.attemptId) return { action: "ignore", reason: "stale_attempt" };

    const state = this.stateOf(message.senderSeatId);
    const text = message.text.trim();

    if (isPromptInjectionAttempt(text)) {
      this.excludedIds.add(message.id);
      state.injectionStrikes += 1;
      if (state.injectionStrikes > MAX_INJECTION_REPLIES) {
        return { action: "ignore", reason: "injection_silenced" };
      }
      return { action: "local_reply", reason: "prompt_injection", response: PROMPT_INJECTION_REPLY };
    }

    const metaCategory = metaCategoryOf(text);
    if (metaCategory) {
      this.excludedIds.add(message.id);
      const seen = (state.metaCounts.get(metaCategory) ?? 0) + 1;
      state.metaCounts.set(metaCategory, seen);
      if (seen > MAX_META_REPLIES_PER_CATEGORY) return { action: "ignore", reason: "meta_repeated" };
      return { action: "local_reply", reason: "meta", response: metaReplyFor(metaCategory, context) };
    }

    // 退避窗口内：不调模型，回固定文案。窗口过期后照常放行一次，让模型有机会判定“已回到正题”。
    if (this.isBackedOff(state)) {
      this.excludedIds.add(message.id);
      return { action: "local_reply", reason: "off_topic_backoff", response: OFF_TOPIC_BACKOFF_REPLY };
    }

    return { action: "allow" };
  }

  private isBackedOff(state: SeatGuardState): boolean {
    if (state.offTopicStrikes >= OFF_TOPIC_HARD_CAP) return true;
    return state.backoffUntil > this.now();
  }

  // 模型返回后由 runtime 回调：off_topic 推进退避阶梯，on_topic 让该座位完全恢复。
  recordModelVerdict(seatId: SeatId, verdict: DiscussionModelVerdict) {
    const state = this.stateOf(seatId);
    if (verdict === "on_topic") {
      state.injectionStrikes = 0;
      state.offTopicStrikes = 0;
      state.backoffUntil = 0;
      return;
    }

    state.offTopicStrikes += 1;
    const level = state.offTopicStrikes - OFF_TOPIC_BACKOFF_START;
    if (level < 0) return;
    const windowMs = OFF_TOPIC_BACKOFF_MS[Math.min(level, OFF_TOPIC_BACKOFF_MS.length - 1)];
    state.backoffUntil = this.now() + windowMs;
  }
}
